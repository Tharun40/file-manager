import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Edit2,
  File,
  FileImage,
  FileText,
  Folder,
  Plus,
  Search,
  Trash2
} from "lucide-react";

const BASE_URL = "http://localhost:5286";

const FILE_TYPE_META = [
  { key: "images", label: "Images", color: "#38bdf8" },
  { key: "videos", label: "Videos", color: "#34d399" },
  { key: "docs", label: "Docs", color: "#f59e0b" },
  { key: "others", label: "Others", color: "#94a3b8" }
];

function App() {
  const [drives, setDrives] = useState([]);
  const [files, setFiles] = useState({ folders: [], files: [] });
  const [selectedPath, setSelectedPath] = useState("");
  const [error, setError] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [menu, setMenu] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);
  const [dragOverFolder, setDragOverFolder] = useState(null);
  const searchTimeoutRef = useRef(null);
  const requestSeqRef = useRef(0);
  const [storage, setStorage] = useState(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const [storageInsights, setStorageInsights] = useState({
    fileTypes: [],
    topFolders: [],
    insight: "",
    totalSize: 0,
    analyzedFiles: 0
  });
  const [activeFileType, setActiveFileType] = useState("all");
  const [hoveredFileType, setHoveredFileType] = useState(null);
  const [insightsUpdatedAt, setInsightsUpdatedAt] = useState(null);
  const [, setClockTick] = useState(0);
  useEffect(() => {
    fetch(`${BASE_URL}/api/files/drives`)
      .then((response) => response.json())
      .then((data) => {
        setDrives(data);
        if (data.length > 0) {
          openFolder(data[0].name);
        }
      })
      .catch((err) => setError(err.message));
  }, []);
  useEffect(() => {
    const closeMenu = () => setMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClockTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!selectedItem) return;
      if (event.key === "Delete") {
        deleteItem(selectedItem.path);
      }
      if (event.key === "Enter" && selectedItem.type === "folder") {
        openFolder(selectedItem.path);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedItem]);

  useEffect(() => {
    if (!currentPath) return;

    const storageAbortController = new AbortController();
    const insightsAbortController = new AbortController();

    const debounceHandle = setTimeout(() => {
      setStorageLoading(true);
      setInsightsLoading(true);
      setInsightsError("");
      setStorageInsights({ fileTypes: [], topFolders: [], insight: "", totalSize: 0, analyzedFiles: 0 });

      const driveRoot = getDriveRoot(currentPath);

      fetch(`${BASE_URL}/api/files/drive-info?path=${encodeURIComponent(driveRoot)}`, {
        signal: storageAbortController.signal
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Unable to load storage info");
          }
          return response.json();
        })
        .then((data) => {
          setStorage(data);
          setStorageLoading(false);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          setStorage(null);
          setStorageLoading(false);
        });

      fetch(`${BASE_URL}/api/files/storage-insights?path=${encodeURIComponent(currentPath)}`, {
        signal: insightsAbortController.signal
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Unable to load storage insights");
          }
          return response.json();
        })
        .then((data) => {
          setStorageInsights({
            fileTypes: Array.isArray(data.fileTypes) ? data.fileTypes : [],
            topFolders: Array.isArray(data.topFolders) ? data.topFolders : [],
            insight: data.insight || "Your storage distribution looks balanced.",
            totalSize: Number(data.totalSize || 0),
            analyzedFiles: Number(data.analyzedFiles || 0)
          });
          setInsightsUpdatedAt(Date.now());
          setInsightsLoading(false);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          setInsightsError(err.message || "Insights unavailable");
          setInsightsLoading(false);
        });
    }, 150);

    return () => {
      clearTimeout(debounceHandle);
      storageAbortController.abort();
      insightsAbortController.abort();
    };
  }, [currentPath]);

  function getDriveRoot(path) {
    const normalized = (path || "").replaceAll("/", "\\");
    const match = normalized.match(/^[A-Za-z]:\\/);
    return match ? match[0] : normalized;
  }

  function formatSize(bytes) {
    if (bytes == null || Number.isNaN(bytes)) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
  }

  const formatBytes = formatSize;

  function getFileCategory(fileName) {
    const extension = fileName.split(".").pop().toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(extension)) {
      return "images";
    }
    if (["mp4", "mov", "avi", "mkv", "webm"].includes(extension)) {
      return "videos";
    }
    if (["txt", "md", "doc", "docx", "pdf", "rtf", "xls", "xlsx", "ppt", "pptx"].includes(extension)) {
      return "docs";
    }
    return "others";
  }

  function getFileIcon(fileName) {
    const category = getFileCategory(fileName);
    if (category === "images") return <FileImage size={20} />;
    if (category === "docs") return <FileText size={20} />;
    return <File size={20} />;
  }

  function getStorageState(percent) {
    if (percent > 90) return "danger";
    if (percent >= 70) return "warning";
    return "normal";
  }

  function getDriveUsagePercent(drive) {
    if (!drive || !drive.total) return 0;
    return Math.min(100, (Number(drive.used || 0) / Number(drive.total || 1)) * 100);
  }

  function getFileTypeLookup() {
    return storageInsights.fileTypes.reduce((accumulator, fileType) => {
      accumulator[fileType.type] = Number(fileType.size || 0);
      return accumulator;
    }, {});
  }

  function getFileTypeMeta(type) {
    return FILE_TYPE_META.find((item) => item.key === type) || null;
  }

  function getPercent(part, whole) {
    if (!whole) return 0;
    return Math.round((Number(part || 0) / Number(whole || 1)) * 100);
  }

  function getRelativeTimeLabel(timestamp) {
    if (!timestamp) return "Never";

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSeconds < 60) {
      return `${elapsedSeconds}s ago`;
    }

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) {
      return `${elapsedMinutes}m ago`;
    }

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    return `${elapsedHours}h ago`;
  }

  // Selecting a file type narrows the file list without hiding folders, so navigation stays available.
  function handleTypeSelect(type) {
    setActiveFileType(type);
    setSelectedItem(null);
  }

  function clearTypeFilter() {
    setActiveFileType("all");
  }

  // This action lets the user jump straight to the biggest folder from the insight card.
  function openLargestFolder() {
    const largestFolder = storageInsights.topFolders[0];
    if (largestFolder?.path) {
      openFolder(largestFolder.path);
    }
  }

  function openFolder(path) {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;

    setSelectedPath(path);
    setCurrentPath(path);
    setError("");
    setSearchQuery("");
    setSelectedItem(null);
    setIsLoading(true);

    fetch(`${BASE_URL}/api/files/list?path=${encodeURIComponent(path)}`)
      .then((response) => {
        if (!response.ok) {
          return response.text().then((message) => {
            throw new Error(message || "Unable to open path");
          });
        }
        return response.json();
      })
      .then((data) => {
        if (requestId !== requestSeqRef.current) return;
        setFiles(data);
        setIsLoading(false);
      })
      .catch((err) => {
        if (requestId !== requestSeqRef.current) return;
        setError(err.message);
        setIsLoading(false);
      });
  }

  function deleteItem(path) {
    if (!confirm("Are you sure you want to delete this?")) return;
    setActionFeedback({ type: "loading", message: "Deleting..." });

    fetch(`${BASE_URL}/api/files/delete?path=${encodeURIComponent(path)}`, {
      method: "DELETE"
    })
      .then((response) => {
        if (!response.ok) throw new Error("Delete failed");
        return response.text();
      })
      .then(() => {
        setActionFeedback({ type: "success", message: "Deleted successfully" });
        setTimeout(() => setActionFeedback(null), 2000);
        openFolder(currentPath);
      })
      .catch((err) => {
        setActionFeedback({ type: "error", message: err.message });
        setTimeout(() => setActionFeedback(null), 3000);
      });
  }

  function createFolder() {
    const name = prompt("Enter folder name");
    if (!name) return;

    const newPath = `${currentPath}\\${name}`;
    setActionFeedback({ type: "loading", message: "Creating folder..." });

    fetch(`${BASE_URL}/api/files/create-folder?path=${encodeURIComponent(newPath)}`, {
      method: "POST"
    })
      .then((response) => {
        if (!response.ok) throw new Error("Create failed");
        return response.text();
      })
      .then(() => {
        setActionFeedback({ type: "success", message: "Folder created" });
        setTimeout(() => setActionFeedback(null), 2000);
        openFolder(currentPath);
      })
      .catch((err) => {
        setActionFeedback({ type: "error", message: err.message });
        setTimeout(() => setActionFeedback(null), 3000);
      });
  }

  function createFolderIn(parentPath) {
    const name = prompt("Enter folder name");
    if (!name) return;

    const newPath = `${parentPath}\\${name}`;
    setActionFeedback({ type: "loading", message: "Creating folder..." });

    fetch(`${BASE_URL}/api/files/create-folder?path=${encodeURIComponent(newPath)}`, {
      method: "POST"
    })
      .then((response) => {
        if (!response.ok) throw new Error("Create failed");
        return response.text();
      })
      .then(() => {
        setActionFeedback({ type: "success", message: "Folder created" });
        setTimeout(() => setActionFeedback(null), 2000);
        openFolder(currentPath);
      })
      .catch((err) => {
        setActionFeedback({ type: "error", message: err.message });
        setTimeout(() => setActionFeedback(null), 3000);
      });
  }

  function renameItem(oldPath) {
    const newName = prompt("Enter new name");
    if (!newName) return;

    const basePath = oldPath.substring(0, oldPath.lastIndexOf("\\") + 1);
    const newPath = basePath + newName;
    setActionFeedback({ type: "loading", message: "Renaming..." });

    fetch(`${BASE_URL}/api/files/rename?oldPath=${encodeURIComponent(oldPath)}&newPath=${encodeURIComponent(newPath)}`, {
      method: "POST"
    })
      .then((response) => {
        if (!response.ok) throw new Error("Rename failed");
        return response.text();
      })
      .then(() => {
        setActionFeedback({ type: "success", message: "Renamed successfully" });
        setTimeout(() => setActionFeedback(null), 2000);
        openFolder(currentPath);
      })
      .catch((err) => {
        setActionFeedback({ type: "error", message: err.message });
        setTimeout(() => setActionFeedback(null), 3000);
      });
  }

  function debouncedSearch(value) {
    clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setSearchQuery(value), 150);
  }

  const filteredFolders = files.folders.filter((folder) =>
    folder.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredFiles = files.files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const breadcrumbs = currentPath
    ? currentPath
        .split("\\")
        .filter(Boolean)
        .reduce((accumulator, part, index) => {
          const path = index === 0 ? `${part}\\` : `${accumulator[index - 1].path}${part}\\`;
          accumulator.push({ name: part, path });
          return accumulator;
        }, [])
    : [];

  const fileTypeLookup = getFileTypeLookup();

  const chartValues = FILE_TYPE_META.map((item) => ({
    ...item,
    value: Number(fileTypeLookup[item.key] || 0)
  }));
  const chartTotal = chartValues.reduce((sum, item) => sum + item.value, 0);
  const dominantType = chartValues.reduce(
    (best, item) => (item.value > best.value ? item : best),
    chartValues[0] || { key: "all", label: "All", value: 0, color: "#38bdf8" }
  );
  const dominantTypePercent = chartTotal > 0 ? Math.round((dominantType.value / chartTotal) * 100) : 0;
  const visibleFiles = activeFileType === "all"
    ? filteredFiles
    : filteredFiles.filter((file) => getFileCategory(file.name) === activeFileType);
  const activeTypeMeta = activeFileType === "all" ? null : getFileTypeMeta(activeFileType);
  const largestFolder = storageInsights.topFolders[0] || null;
  const analyzedTotal = Number(storageInsights.fileTypes.reduce((sum, item) => sum + Number(item.size || 0), 0) || 0);

  function renderStorageCard() {
    const storageTotalValue = storage?.total || 0;
    const storageUsedValue = storage?.used || 0;
    const storageFreeValue = storage?.free || 0;
    const storagePercent = storageTotalValue > 0 ? Math.min(100, (storageUsedValue / storageTotalValue) * 100) : 0;
    const storageState = getStorageState(storagePercent);

    return (
      <section className={`storage-card storage-card--${storageState}`}>
        <div className="section-header">
          <h3>Storage</h3>
          <span className="item-count">{storageLoading ? "Loading" : currentPath}</span>
        </div>

        {storageLoading ? (
          <>
            <div className="storage-card__loading-line" />
            <div className="meter"><div className="meter-fill storage-card__loading-fill" /></div>
            <div className="storage-card__loading-line short" />
          </>
        ) : storage ? (
          <>
            <strong>{`${formatSize(storageUsedValue)} used of ${formatSize(storageTotalValue)}`}</strong>
            <small>{`${formatSize(storageFreeValue)} free`}</small>
            <div className="meter" aria-hidden="true">
              <div className={`meter-fill meter-fill--${storageState}`} style={{ width: `${storagePercent}%` }} />
            </div>
          </>
        ) : (
          <small>Storage info unavailable.</small>
        )}
      </section>
    );
  }

  function renderChartCard() {
    const circumference = 2 * Math.PI * 44;
    let offset = 0;
    const chartInteracted = activeFileType !== "all";

    return (
      <section className="chart-card">
        <div className="section-header">
          <h3>File Types</h3>
          <span className="item-count">{insightsLoading ? "Analyzing" : chartInteracted ? `${activeTypeMeta?.label} selected` : `${dominantTypePercent}% top type`}</span>
        </div>
        {insightsLoading ? (
          <div className="donut-skeleton">
            <div className="donut-skeleton__ring" />
            <div className="donut-skeleton__caption">Analyzing files...</div>
          </div>
        ) : chartTotal > 0 ? (
          <div className="chart-wrap">
            <div className="donut-chart donut-chart--interactive" aria-label="File type distribution">
              <svg viewBox="0 0 120 120" role="img" aria-hidden="true">
                <circle cx="60" cy="60" r="44" className="donut-track" />
                {chartValues.map((segment) => {
                  const dash = segment.value > 0 ? (segment.value / chartTotal) * circumference : 0;
                  const isActive = activeFileType === segment.key;
                  const isDimmed = activeFileType !== "all" && !isActive;
                  const isHovered = hoveredFileType === segment.key;
                  const circle = dash > 0 ? (
                    <circle
                      key={segment.key}
                      cx="60"
                      cy="60"
                      r="44"
                      className={`donut-segment ${isActive ? "active" : ""} ${isDimmed ? "dimmed" : ""} ${isHovered ? "hovered" : ""}`}
                      fill="none"
                      stroke={segment.color}
                      strokeWidth={isActive || isHovered ? 16 : 14}
                      strokeLinecap="round"
                      strokeDasharray={`${dash} ${circumference - dash}`}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 60 60)"
                      onClick={() => handleTypeSelect(segment.key)}
                      onMouseEnter={() => setHoveredFileType(segment.key)}
                      onMouseLeave={() => setHoveredFileType(null)}
                      onFocus={() => setHoveredFileType(segment.key)}
                      onBlur={() => setHoveredFileType(null)}
                      tabIndex={0}
                    >
                      <title>{`${segment.label}: ${formatSize(segment.value)}`}</title>
                    </circle>
                  ) : null;
                  offset += dash;
                  return circle;
                })}
                <circle cx="60" cy="60" r="30" className="donut-center" />
              </svg>
              <div className="donut-center-copy">
                <strong>{formatSize(chartTotal)}</strong>
                <span>{chartInteracted ? `${activeTypeMeta?.label} view` : "total"}</span>
              </div>
            </div>
            <div className="chart-legend">
              <button className="legend-row legend-row--all" type="button" onClick={clearTypeFilter}>
                <span className="legend-swatch legend-swatch--all" />
                <div className="legend-copy">
                  <strong>All files</strong>
                  <span>{formatSize(chartTotal)}</span>
                </div>
                <span className="legend-percent">100%</span>
              </button>
              {chartValues.map((segment) => {
                const percent = chartTotal > 0 ? Math.round((segment.value / chartTotal) * 100) : 0;
                const isActive = activeFileType === segment.key;
                const isHovered = hoveredFileType === segment.key;
                return (
                  <button
                    key={segment.key}
                    type="button"
                    className={`legend-row ${isActive ? "active" : ""} ${isHovered ? "hovered" : ""}`}
                    onClick={() => handleTypeSelect(segment.key)}
                    onMouseEnter={() => setHoveredFileType(segment.key)}
                    onMouseLeave={() => setHoveredFileType(null)}
                  >
                    <span className="legend-swatch" style={{ color: segment.color, backgroundColor: segment.color }} />
                    <div className="legend-copy">
                      <strong>{segment.label}</strong>
                      <span>{`${formatSize(segment.value)} · ${percent}%`}</span>
                    </div>
                    <span className="legend-percent">{percent}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <small className="empty-dashboard-copy">
            {insightsError || "No file type data"}
          </small>
        )}
      </section>
    );
  }

  function renderTopFoldersCard() {
    const analyzedSize = storageInsights.totalSize || storageInsights.fileTypes.reduce((sum, item) => sum + Number(item.size || 0), 0);

    return (
      <section className="top-folders-card">
        <div className="section-header">
          <h3>Top Space Consumers</h3>
          <span className="item-count">{insightsLoading ? "Scanning" : `${storageInsights.topFolders.length} folders`}</span>
        </div>
        {insightsLoading ? (
          <div className="top-folders-skeleton">
            <div />
            <div />
            <div />
          </div>
        ) : storageInsights.topFolders.length > 0 ? (
          <div className="largest-list">
            {storageInsights.topFolders.map((folder, index) => (
              <button key={`${folder.name}-${index}`} type="button" className="largest-row" onClick={() => openFolder(folder.path)}>
                <div className="largest-copy">
                  <strong>{folder.name}</strong>
                  <span>{`#${index + 1} largest`}</span>
                </div>
                <span className="largest-size">{`${formatSize(folder.size || 0)} (${getPercent(folder.size, analyzedSize)}%)`}</span>
              </button>
            ))}
          </div>
        ) : (
          <small className="empty-dashboard-copy">No folder size data</small>
        )}
      </section>
    );
  }

  function renderInsightCard() {
    return (
      <section className="insight-card">
        <div className="section-header">
          <h3>Actionable Insight</h3>
          {largestFolder && (
            <button className="text-action-btn" type="button" onClick={openLargestFolder}>
              Open Largest Folder
            </button>
          )}
        </div>
        {insightsLoading ? (
          <p>Scanning your files for optimization opportunities...</p>
        ) : insightsError ? (
          <p>{insightsError}</p>
        ) : (
          <div className="insight-copy">
            <p>{storageInsights.insight || "Your storage appears healthy with no major concentration risk."}</p>
            <span className="insight-meta">{`Last updated ${getRelativeTimeLabel(insightsUpdatedAt)}`}</span>
          </div>
        )}
      </section>
    );
  }

  function renderDashboard() {
    return (
      <section className="dashboard">
        {renderStorageCard()}
        {renderChartCard()}
        {renderTopFoldersCard()}
        {renderInsightCard()}
      </section>
    );
  }

  function renderHero() {
    return (
      <section className="hero">
        <div>
          <h2>Explorer</h2>
          <p className="lede">Browse drives, folders, and files with quick actions.</p>
        </div>
      </section>
    );
  }

  function renderDetailsPanel() {
    if (!selectedItem) return null;

    const item = selectedItem.type === "folder"
      ? files.folders.find((folder) => folder.path === selectedItem.path)
      : files.files.find((file) => file.path === selectedItem.path);

    if (!item) return null;

    return (
      <div className="details-panel">
        <div className="details-header">
          <h3>Details</h3>
        </div>
        <div className="details-content">
          <div className="detail-item">
            <span className="detail-label">Name</span>
            <span className="detail-value">{item.name}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Path</span>
            <span className="detail-value detail-path">{item.path}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Type</span>
            <span className="detail-value">{selectedItem.type === "folder" ? "Folder" : "File"}</span>
          </div>
          {selectedItem.type === "file" && (
            <>
              <div className="detail-item">
                <span className="detail-label">Extension</span>
                <span className="detail-value">{item.name.split(".").pop() || "—"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Size</span>
                <span className="detail-value">{formatBytes(item.size || 0)}</span>
              </div>
            </>
          )}
          <div className="details-actions">
            <button
              className="detail-action-btn"
              onClick={() => {
                renameItem(selectedItem.path);
                setSelectedItem(null);
              }}
            >
              <Edit2 size={16} /> Rename
            </button>
            <button
              className="detail-action-btn delete"
              onClick={() => {
                deleteItem(selectedItem.path);
                setSelectedItem(null);
              }}
            >
              <Trash2 size={16} /> Delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <div>
            <p className="eyebrow">File Manager</p>
            <h1>Drives</h1>
          </div>
          <nav className="nav">
            {drives.map((drive) => (
              <button
                key={drive.name}
                type="button"
                className={selectedPath === drive.name ? "nav-item active" : "nav-item"}
                onClick={() => openFolder(drive.name)}
              >
                <div className="drive-main">
                  <span className="drive-name">{drive.name}</span>
                  <span className="drive-type">{drive.type}</span>
                </div>
                <div className="drive-usage">
                  <div className="drive-usage-track">
                    <div className="drive-usage-fill" style={{ width: `${getDriveUsagePercent(drive)}%` }} />
                  </div>
                  <span className="drive-usage-text">{`${Math.round(getDriveUsagePercent(drive))}%`}</span>
                </div>
              </button>
            ))}
          </nav>
        </aside>

        <div className="main-content">
          <div className="top-bar">
            <div className="breadcrumb-nav">
              {breadcrumbs.map((breadcrumb, index) => (
                <span key={breadcrumb.path} className="breadcrumb-item">
                  <button className="breadcrumb-btn" onClick={() => openFolder(breadcrumb.path)}>
                    {breadcrumb.name}
                  </button>
                  {index < breadcrumbs.length - 1 && <span className="breadcrumb-sep">/</span>}
                </span>
              ))}
            </div>
            <div className="top-bar-actions">
              <div className="search-box">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Search files..."
                  onChange={(event) => debouncedSearch(event.target.value)}
                  className="search-input"
                />
              </div>
              <button className="action-btn" onClick={createFolder} title="New Folder">
                <Plus size={18} />
              </button>
            </div>
          </div>

          {actionFeedback && (
            <div className={`action-feedback ${actionFeedback.type}`}>
              {actionFeedback.type === "loading" && <div className="spinner" />}
              {actionFeedback.type === "error" && <AlertCircle size={18} />}
              <span>{actionFeedback.message}</span>
            </div>
          )}

          <main className="content" onClick={() => setSelectedItem(null)}>
            {error && (
              <div className="error-state">
                <AlertCircle size={48} />
                <h3>Error</h3>
                <p>{error}</p>
              </div>
            )}

            {renderHero()}
            {currentPath && renderDashboard()}

            {activeFileType !== "all" && (
              <div className="active-filter-banner">
                <span>{`Filtering files by ${activeTypeMeta?.label}`}</span>
                <button type="button" className="text-action-btn" onClick={clearTypeFilter}>
                  Clear filter
                </button>
              </div>
            )}

            {isLoading ? (
              <div className="loading-skeleton">
                {[1, 2, 3].map((index) => (
                  <div key={index} className="skeleton-card" />
                ))}
              </div>
            ) : filteredFolders.length === 0 && visibleFiles.length === 0 ? (
              <div className="empty-state">
                <Folder size={48} />
                <h3>No files found</h3>
                <p>
                  {searchQuery
                    ? "Try a different search term"
                    : activeFileType !== "all"
                      ? `No ${activeTypeMeta?.label.toLowerCase()} files in this folder`
                      : "This folder is empty"}
                </p>
              </div>
            ) : (
              <>
                {filteredFolders.length > 0 && (
                  <section className="content-section">
                    <div className="section-header">
                      <h3>Folders</h3>
                      <span className="item-count">{filteredFolders.length}</span>
                    </div>
                    <div className="folder-grid">
                      {filteredFolders.map((folder) => (
                        <div
                          key={folder.path}
                          className={`folder-card ${selectedItem?.path === folder.path ? "active" : ""} ${dragOverFolder === folder.path ? "drag-over" : ""}`}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("application/json", JSON.stringify({ ...folder, type: "folder" }));
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDragEnter={() => setDragOverFolder(folder.path)}
                          onDragLeave={() => setDragOverFolder(null)}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setDragOverFolder(null);
                            try {
                              const draggedItem = JSON.parse(event.dataTransfer.getData("application/json"));
                              if (draggedItem.path !== folder.path) {
                                setActionFeedback({ type: "loading", message: "Moving item..." });
                                setTimeout(() => {
                                  setActionFeedback({ type: "success", message: "Item moved" });
                                  setTimeout(() => setActionFeedback(null), 2000);
                                  openFolder(currentPath);
                                }, 350);
                              }
                            } catch {
                              setActionFeedback({ type: "error", message: "Unable to move item" });
                              setTimeout(() => setActionFeedback(null), 3000);
                            }
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedItem({ path: folder.path, type: "folder" });
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            openFolder(folder.path);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setMenu({ x: event.pageX, y: event.pageY, path: folder.path, type: "folder" });
                          }}
                        >
                          <div className="folder-icon">
                            <Folder size={32} />
                          </div>
                          <div className="folder-info">
                            <h4 title={folder.name}>{folder.name}</h4>
                          </div>
                          <div className="folder-quick-actions">
                            <button
                              type="button"
                              className="folder-quick-btn"
                              title="Rename"
                              onClick={(event) => {
                                event.stopPropagation();
                                renameItem(folder.path);
                              }}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              type="button"
                              className="folder-quick-btn"
                              title="Delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteItem(folder.path);
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                            <button
                              type="button"
                              className="folder-quick-btn"
                              title="New Folder"
                              onClick={(event) => {
                                event.stopPropagation();
                                createFolderIn(folder.path);
                              }}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {(visibleFiles.length > 0 || activeFileType !== "all" || searchQuery) && (
                  <section className="content-section">
                    <div className="section-header">
                      <h3>Files</h3>
                      <span className="item-count">{visibleFiles.length}</span>
                    </div>
                    {visibleFiles.length > 0 ? (
                      <div className="file-list">
                        {visibleFiles.map((file) => (
                          <article
                            key={file.path}
                            className={`file-row ${selectedItem?.path === file.path ? "active" : ""}`}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("application/json", JSON.stringify({ ...file, type: "file" }));
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedItem({ path: file.path, type: "file" });
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setMenu({ x: event.pageX, y: event.pageY, path: file.path, type: "file" });
                            }}
                          >
                            <div className="file-icon">{getFileIcon(file.name)}</div>
                            <div className="file-info">
                              <h4 title={file.name}>{file.name}</h4>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <small className="empty-dashboard-copy">
                        {activeFileType !== "all" ? `No ${activeTypeMeta?.label.toLowerCase()} files match this view` : "No files match this search"}
                      </small>
                    )}
                  </section>
                )}
              </>
            )}
          </main>
        </div>

        {renderDetailsPanel()}
      </div>

      {menu && (
        <div className="context-menu" style={{ top: menu.y, left: menu.x }}>
          <button
            className="context-menu-item"
            onClick={(event) => {
              event.stopPropagation();
              renameItem(menu.path);
              setMenu(null);
            }}
          >
            <Edit2 size={16} /> Rename
          </button>
          <button
            className="context-menu-item delete"
            onClick={() => {
              deleteItem(menu.path);
              setMenu(null);
            }}
          >
            <Trash2 size={16} /> Delete
          </button>
          {menu.type === "folder" && (
            <button
              className="context-menu-item"
              onClick={() => {
                createFolder();
                setMenu(null);
              }}
            >
              <Plus size={16} /> New Folder
            </button>
          )}
        </div>
      )}
    </>
    
  );
}

export default App;