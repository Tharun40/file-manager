import { useEffect, useState } from "react";

const BASE_URL = "http://localhost:5286";

function App() {
  const [drives, setDrives] = useState([]);
  const [files, setFiles] = useState({ folders: [], files: [] });
  const [selectedPath, setSelectedPath] = useState("");
  const [error, setError] = useState("");

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

  const openFolder = (path) => {
    setSelectedPath(path);
    setError("");

    fetch(`${BASE_URL}/api/files/list?path=${encodeURIComponent(path)}`)
      .then((response) => {
        if (!response.ok) {
          return response.text().then((message) => {
            throw new Error(message || "Unable to open path");
          });
        }

        return response.json();
      })
      .then((data) => setFiles(data))
      .catch((err) => setError(err.message));
  };

  return (
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
              {drive.name} <span>{drive.type}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        <section className="hero">
          <div>
            <p className="eyebrow">Current path</p>
            <h2>{selectedPath || "Select a drive"}</h2>
            <p className="lede">
              Browse folders and files returned by the ASP.NET API.
            </p>
          </div>
        </section>

        {error ? <div className="panel">{error}</div> : null}

        <section className="panel">
          <div className="panel-header">
            <h3>Folders</h3>
            <span>{files.folders.length} items</span>
          </div>
          <div className="folder-grid">
            {files.folders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                className="folder-card"
                onClick={() => openFolder(folder.path)}
              >
                <div className="folder-icon">▣</div>
                <div>
                  <h4>{folder.name}</h4>
                  <p>{folder.path}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>Files</h3>
            <span>{files.files.length} items</span>
          </div>
          <div className="file-list">
            {files.files.map((file) => (
              <article className="file-row" key={file.path}>
                <div>
                  <h4>{file.name}</h4>
                  <p>{file.path}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;