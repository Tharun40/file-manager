using Microsoft.AspNetCore.Mvc;
using System.IO;
using System.Linq;

[ApiController]
[Route("api/files")]
public class FileController : ControllerBase
{
    [HttpGet("drives")]
    public IActionResult GetDrives()
    {
        var drives = DriveInfo.GetDrives()
            .Select(d => new {
                name = d.Name,
                type = d.DriveType.ToString()
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
                path = d
            });

        var files = Directory.GetFiles(path)
            .Select(f => new {
                name = Path.GetFileName(f),
                path = f
            });

        return Ok(new { folders, files });
    }
}