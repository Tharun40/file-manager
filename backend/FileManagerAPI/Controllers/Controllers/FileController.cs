using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Text.Json;

[ApiController]
[Route("api/files")]
public class FileController : ControllerBase
{
    private static readonly JsonSerializerOptions StreamJsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan AnalyticsCacheDuration = TimeSpan.FromMinutes(5);
    private static readonly EnumerationOptions SafeEnumerationOptions = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        AttributesToSkip = FileAttributes.ReparsePoint
    };

    private static readonly string[] ImageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg"];
    private static readonly string[] VideoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
    private static readonly string[] DocumentExtensions = [".pdf", ".doc", ".docx", ".txt", ".rtf", ".md", ".xls", ".xlsx", ".ppt", ".pptx"];

    private readonly IMemoryCache _cache;

    public FileController(IMemoryCache cache)
    {
        _cache = cache;
    }

    [HttpGet("drives")]
    public IActionResult GetDrives()
    {
        var drives = DriveInfo.GetDrives()
            .Select(d => new {
                name = d.Name,
                type = d.DriveType.ToString(),
                total = d.IsReady ? d.TotalSize : 0,
                free = d.IsReady ? d.AvailableFreeSpace : 0,
                used = d.IsReady ? d.TotalSize - d.AvailableFreeSpace : 0
            });

        return Ok(drives);
    }

    [HttpGet("list")]
    public IActionResult GetFiles(string path)
    {
        if (!Directory.Exists(path))
            return BadRequest("Invalid path");

        var folders = Directory.GetDirectories(path)
            .Select(d => new {
                name = Path.GetFileName(d),
                path = d,
                kind = "folder"
            });

        var files = Directory.GetFiles(path)
            .Select(f => new {
                name = Path.GetFileName(f),
                path = f,
                kind = "file",
                size = new FileInfo(f).Length
            });

        return Ok(new { folders, files });
    }

    [HttpGet("drive-info")]
    public IActionResult GetDriveInfo(string path)
    {
        try
        {
            var root = Path.GetPathRoot(path ?? string.Empty) ?? path;
            if (string.IsNullOrWhiteSpace(root))
                return BadRequest("Invalid path");

            var drive = new DriveInfo(root);

            if (!drive.IsReady)
                return BadRequest("Drive is not ready");

            return Ok(new
            {
                total = drive.TotalSize,
                used = drive.TotalSize - drive.AvailableFreeSpace,
                free = drive.AvailableFreeSpace
            });
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpGet("folder-size")]
    public async Task<IActionResult> GetFolderSize(string path)
    {
        if (!Directory.Exists(path))
            return BadRequest("Invalid path");

        try
        {
            var totalBytes = await Task.Run(() =>
            {
                long size = 0;

                foreach (var filePath in Directory.EnumerateFiles(path, "*", SafeEnumerationOptions))
                {
                    try
                    {
                        size += new FileInfo(filePath).Length;
                    }
                    catch
                    {
                    }
                }

                return size;
            });

            return Ok(new { size = totalBytes });
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpGet("file-type-stats")]
    public async Task<IActionResult> GetFileTypeStats(string path)
    {
        if (!Directory.Exists(path))
            return BadRequest("Invalid path");

        try
        {
            var stats = await CollectAnalyticsAsync(path, null, cancellationToken: default);

            return Ok(stats.Data);
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpGet("storage-insights")]
    public async Task<IActionResult> GetStorageInsights(string path, CancellationToken cancellationToken)
    {
        if (!Directory.Exists(path))
        {
            return BadRequest("Invalid path");
        }

        var normalizedPath = Path.GetFullPath(path);
        var cacheKey = $"storage-insights:{normalizedPath.ToUpperInvariant()}";

        if (_cache.TryGetValue(cacheKey, out StorageInsightsResponse? cachedInsights) && cachedInsights is not null)
        {
            return Ok(cachedInsights);
        }

        try
        {
            var insights = await BuildStorageInsightsAsync(normalizedPath, cancellationToken);
            _cache.Set(cacheKey, insights, new MemoryCacheEntryOptions
            {
                SlidingExpiration = AnalyticsCacheDuration,
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10)
            });

            return Ok(insights);
        }
        catch (OperationCanceledException)
        {
            return StatusCode(499, "Request cancelled");
        }
        catch (Exception ex)
        {
            return BadRequest(ex.Message);
        }
    }

    private async Task<StorageInsightsResponse> BuildStorageInsightsAsync(string path, CancellationToken cancellationToken)
    {
        return await Task.Run(() =>
        {
            var normalizedRoot = path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var typeTotals = new Dictionary<string, long>
            {
                ["images"] = 0,
                ["videos"] = 0,
                ["docs"] = 0,
                ["others"] = 0
            };
            var folderTotals = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            long analyzedFiles = 0;
            long totalSize = 0;

            foreach (var filePath in Directory.EnumerateFiles(path, "*", SafeEnumerationOptions))
            {
                cancellationToken.ThrowIfCancellationRequested();

                long size;
                try
                {
                    size = new FileInfo(filePath).Length;
                }
                catch
                {
                    continue;
                }

                analyzedFiles += 1;
                totalSize += size;

                var category = GetFileCategory(filePath);
                typeTotals[category] += size;

                var topFolder = GetTopFolderBucket(normalizedRoot, filePath);
                if (!folderTotals.ContainsKey(topFolder))
                {
                    folderTotals[topFolder] = 0;
                }

                folderTotals[topFolder] += size;
            }

            var fileTypes = typeTotals
                .Select(item => new StorageFileTypeItem(item.Key, item.Value))
                .OrderByDescending(item => item.Size)
                .ToList();

            var topFolders = folderTotals
                .OrderByDescending(item => item.Value)
                .Take(5)
                .Select(item => new StorageFolderItem(item.Key, BuildFolderPath(path, item.Key), item.Value))
                .ToList();

            var insight = BuildInsightMessage(fileTypes, topFolders, totalSize);
            return new StorageInsightsResponse(fileTypes, topFolders, insight, totalSize, analyzedFiles);
        }, cancellationToken);
    }

    private static string GetTopFolderBucket(string rootPath, string filePath)
    {
        var fileDirectory = Path.GetDirectoryName(filePath) ?? rootPath;
        var relativeDirectory = Path.GetRelativePath(rootPath, fileDirectory);

        if (string.Equals(relativeDirectory, ".", StringComparison.Ordinal))
        {
            return "Current folder";
        }

        var parts = relativeDirectory
            .Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries);

        return parts.Length > 0 ? parts[0] : "Current folder";
    }

    private static string BuildFolderPath(string rootPath, string folderName)
    {
        if (string.Equals(folderName, "Current folder", StringComparison.Ordinal))
        {
            return rootPath;
        }

        return Path.Combine(rootPath, folderName);
    }

    private static string BuildInsightMessage(IReadOnlyList<StorageFileTypeItem> fileTypes, IReadOnlyList<StorageFolderItem> topFolders, long totalSize)
    {
        if (totalSize <= 0)
        {
            return "No files found in this location yet. Add content to generate insights.";
        }

        var dominantType = fileTypes.OrderByDescending(item => item.Size).First();
        var dominantPercent = (int)Math.Round((double)dominantType.Size / totalSize * 100);
        var dominantLabel = char.ToUpperInvariant(dominantType.Type[0]) + dominantType.Type[1..];

        if (topFolders.Count == 0)
        {
            return $"{dominantLabel} are using {dominantPercent}% of your analyzed storage.";
        }

        return $"{dominantLabel} are using {dominantPercent}% of your analyzed storage. Review {topFolders[0].Name} first to reclaim space quickly.";
    }

    [HttpGet("analytics-stream")]
    public async Task AnalyticsStream(string path, CancellationToken cancellationToken)
    {
        Response.ContentType = "application/x-ndjson";
        Response.Headers["Cache-Control"] = "no-cache";

        if (!Directory.Exists(path))
        {
            Response.StatusCode = 400;
            await WriteStreamEventAsync(new { type = "error", message = "Invalid path" }, cancellationToken);
            return;
        }

        var cacheKey = $"analytics:{path}";
        if (_cache.TryGetValue(cacheKey, out FileAnalyticsSnapshot? cached) && cached is not null)
        {
            await WriteStreamEventAsync(new
            {
                type = "cached",
                data = cached.Data,
                processedFiles = cached.ProcessedFiles,
                totalBytes = cached.TotalBytes
            }, cancellationToken);

            await WriteStreamEventAsync(new
            {
                type = "complete",
                data = cached.Data,
                processedFiles = cached.ProcessedFiles,
                totalFiles = cached.ProcessedFiles,
                totalBytes = cached.TotalBytes
            }, cancellationToken);

            return;
        }

        var snapshot = await CollectAnalyticsAsync(path, async (batch, processedFiles, totalBytes) =>
        {
            await WriteStreamEventAsync(new
            {
                type = "batch",
                data = batch.ToDictionary(),
                processedFiles,
                totalBytes
            }, cancellationToken);
        }, cancellationToken);

        _cache.Set(cacheKey, snapshot, new MemoryCacheEntryOptions
        {
            SlidingExpiration = AnalyticsCacheDuration,
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10)
        });

        await WriteStreamEventAsync(new
        {
            type = "complete",
            data = snapshot.Data,
            processedFiles = snapshot.ProcessedFiles,
            totalFiles = snapshot.ProcessedFiles,
            totalBytes = snapshot.TotalBytes
        }, cancellationToken);
    }

    private async Task<FileAnalyticsSnapshot> CollectAnalyticsAsync(
        string path,
        Func<FileAnalyticsTotals, long, long, Task>? onBatch,
        CancellationToken cancellationToken,
        int batchSize = 100)
    {
        var totals = new FileAnalyticsTotals();
        var batchTotals = new FileAnalyticsTotals();
        long processedFiles = 0;
        long totalBytes = 0;
        var batchCount = 0;

        await Task.Yield();

        foreach (var filePath in Directory.EnumerateFiles(path, "*", SafeEnumerationOptions))
        {
            cancellationToken.ThrowIfCancellationRequested();

            long size;
            try
            {
                size = new FileInfo(filePath).Length;
            }
            catch
            {
                continue;
            }

            var category = GetFileCategory(filePath);
            totals.Add(category, size);
            batchTotals.Add(category, size);
            processedFiles += 1;
            totalBytes += size;
            batchCount += 1;

            if (batchCount < batchSize)
            {
                continue;
            }

            if (onBatch is not null)
            {
                await onBatch(batchTotals.Clone(), processedFiles, totalBytes);
            }

            batchTotals.Clear();
            batchCount = 0;
        }

        if (batchCount > 0 && onBatch is not null)
        {
            await onBatch(batchTotals.Clone(), processedFiles, totalBytes);
        }

        return new FileAnalyticsSnapshot(totals.ToDictionary(), processedFiles, totalBytes);
    }

    private static string GetFileCategory(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLowerInvariant();

        if (ImageExtensions.Contains(extension))
        {
            return "images";
        }

        if (VideoExtensions.Contains(extension))
        {
            return "videos";
        }

        if (DocumentExtensions.Contains(extension))
        {
            return "docs";
        }

        return "others";
    }

    private async Task WriteStreamEventAsync(object payload, CancellationToken cancellationToken)
    {
        await Response.WriteAsync(JsonSerializer.Serialize(payload, StreamJsonOptions), cancellationToken);
        await Response.WriteAsync("\n", cancellationToken);
        await Response.Body.FlushAsync(cancellationToken);
    }

    private sealed record StorageFileTypeItem(string Type, long Size);
    private sealed record StorageFolderItem(string Name, string Path, long Size);
    private sealed record StorageInsightsResponse(
        IReadOnlyList<StorageFileTypeItem> FileTypes,
        IReadOnlyList<StorageFolderItem> TopFolders,
        string Insight,
        long TotalSize,
        long AnalyzedFiles);

    private sealed class FileAnalyticsTotals
    {
        public long Images { get; private set; }
        public long Videos { get; private set; }
        public long Docs { get; private set; }
        public long Others { get; private set; }

        public void Add(string category, long size)
        {
            switch (category)
            {
                case "images":
                    Images += size;
                    break;
                case "videos":
                    Videos += size;
                    break;
                case "docs":
                    Docs += size;
                    break;
                default:
                    Others += size;
                    break;
            }
        }

        public void Clear()
        {
            Images = 0;
            Videos = 0;
            Docs = 0;
            Others = 0;
        }

        public FileAnalyticsTotals Clone()
        {
            return new FileAnalyticsTotals
            {
                Images = Images,
                Videos = Videos,
                Docs = Docs,
                Others = Others
            };
        }

        public Dictionary<string, long> ToDictionary()
        {
            return new Dictionary<string, long>
            {
                ["images"] = Images,
                ["videos"] = Videos,
                ["docs"] = Docs,
                ["others"] = Others
            };
        }
    }

    private sealed record FileAnalyticsSnapshot(Dictionary<string, long> Data, long ProcessedFiles, long TotalBytes);

    [HttpDelete("delete")]
public IActionResult Delete(string path)
{
    try
    {
        if (System.IO.File.Exists(path))
        {
            System.IO.File.Delete(path);
        }
        else if (Directory.Exists(path))
        {
            Directory.Delete(path, true);
        }
        else
        {
            return NotFound("Path not found");
        }

        return Ok("Deleted successfully");
    }
    catch (Exception ex)
    {
        return BadRequest(ex.Message);
    }
}
[HttpPost("create-folder")]
public IActionResult CreateFolder(string path)
{
    try
    {
        if (Directory.Exists(path))
            return BadRequest("Folder already exists");

        Directory.CreateDirectory(path);
        return Ok("Folder created");
    }
    catch (Exception ex)
    {
        return BadRequest(ex.Message);
    }
}
[HttpPost("rename")]
public IActionResult Rename(string oldPath, string newPath)
{
    try
    {
        if (System.IO.File.Exists(oldPath))
        {
            System.IO.File.Move(oldPath, newPath);
        }
        else if (Directory.Exists(oldPath))
        {
            Directory.Move(oldPath, newPath);
        }
        else
        {
            return NotFound("Path not found");
        }

        return Ok("Renamed successfully");
    }
    catch (Exception ex)
    {
        return BadRequest(ex.Message);
    }
}
[HttpGet("stats")]
public IActionResult GetFileStats(string path)
{
    try
    {
        var files = Directory.GetFiles(path, "*.*", SearchOption.AllDirectories);

        long images = 0, videos = 0, docs = 0, others = 0;

        foreach (var file in files)
        {
            var ext = Path.GetExtension(file).ToLower();
            var size = new FileInfo(file).Length;

            if (new[] { ".png", ".jpg", ".jpeg", ".gif" }.Contains(ext))
                images += size;
            else if (new[] { ".mp4", ".mkv", ".avi" }.Contains(ext))
                videos += size;
            else if (new[] { ".pdf", ".doc", ".txt" }.Contains(ext))
                docs += size;
            else
                others += size;
        }

        return Ok(new
        {
            images,
            videos,
            documents = docs,
            others
        });
    }
    catch (Exception ex)
    {
        return BadRequest(ex.Message);
    }
}
}

