import { useState, useEffect } from 'react';
import {
  listYears,
  listMonths,
  syncEvents,
  getEvents,
  downloadEvent,
  checkDownloadStatus,
  deleteDownload,
  getLocalFileUrl,
  getSyncStatus
} from './services/s3';
import { type S3File, type EventMetadata } from './types';
import './App.css';

function App() {
  const [years, setYears] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [events, setEvents] = useState<EventMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [downloadedEvents, setDownloadedEvents] = useState<Set<string>>(new Set());
  const [downloadingEvents, setDownloadingEvents] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<'eventId' | 'userId' | 'deviceId' | 'timestamp' | 'fileCount'>('timestamp');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Load years on mount and auto-select most recent
  useEffect(() => {
    const loadYears = async () => {
      setLoading(true);
      setError(null);
      try {
        const yearList = await listYears();
        setYears(yearList);

        // Auto-select most recent year
        if (yearList.length > 0) {
          setSelectedYear(yearList[0]);
        }
      } catch (err) {
        const errorMsg = `Failed to load years: ${err instanceof Error ? err.message : 'Unknown error'}`;
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    };
    loadYears();
  }, []);

  // Load months when year is selected and auto-select most recent
  useEffect(() => {
    if (!selectedYear) {
      setMonths([]);
      setSelectedMonth(null);
      return;
    }

    const loadMonths = async () => {
      setLoading(true);
      setError(null);
      try {
        const monthList = await listMonths(selectedYear);
        setMonths(monthList);

        // Auto-select most recent month
        if (monthList.length > 0) {
          setSelectedMonth(monthList[0]);
        }
      } catch (err) {
        const errorMsg = `Failed to load months: ${err instanceof Error ? err.message : 'Unknown error'}`;
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    };
    loadMonths();
  }, [selectedYear]);

  // Load events from DB when month is selected
  useEffect(() => {
    if (!selectedYear || !selectedMonth) {
      setEvents([]);
      return;
    }

    const loadEvents = async () => {
      setLoading(true);
      setError(null);
      try {
        const dbEvents = await getEvents(selectedYear, selectedMonth, sortColumn, sortDirection);
        setEvents(dbEvents);

        // Check sync status
        const status = await getSyncStatus(selectedYear, selectedMonth);
        if (status.last_synced_at) {
          setLastSyncedAt(new Date(status.last_synced_at));
        }
        setSyncStatus(status.status);

        // Auto-sync if never synced or error
        if (!status.last_synced_at || status.status === 'error') {
          handleSync(false); // Auto-sync (not forced)
        }
      } catch (err) {
        const errorMsg = `Failed to load events: ${err instanceof Error ? err.message : 'Unknown error'}`;
        setError(errorMsg);

        // If failed to load events (e.g. DB empty), try syncing
        handleSync(false);
      } finally {
        setLoading(false);
      }
    };
    loadEvents();

    // Poll for sync status if syncing
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    if (syncing || syncStatus === 'syncing') {
      pollInterval = setInterval(async () => {
        try {
          const status = await getSyncStatus(selectedYear, selectedMonth);
          setSyncStatus(status.status);
          if (status.last_synced_at) {
            setLastSyncedAt(new Date(status.last_synced_at));
          }

          if (status.status === 'idle' && (syncing || syncStatus === 'syncing')) {
            // Sync finished, reload events
            setSyncing(false);
            const dbEvents = await getEvents(selectedYear, selectedMonth, sortColumn, sortDirection);
            setEvents(dbEvents);
          }
        } catch (e) {
          console.error('Poll failed', e);
        }
      }, 2000);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [selectedYear, selectedMonth, sortColumn, sortDirection, syncing, syncStatus]);

  // Sync events from S3 to DB
  const handleSync = async (force: boolean = true) => {
    if (!selectedYear || !selectedMonth) return;

    setSyncing(true);
    setSyncStatus('syncing');
    setError(null);
    try {
      const result = await syncEvents(selectedYear, selectedMonth, force);

      if (result.skipped) {
        console.log('Sync skipped: recently synced');
        setSyncing(false);
        setSyncStatus('idle');
        if (result.lastSyncedAt) {
          setLastSyncedAt(new Date(result.lastSyncedAt));
        }
        return;
      }

      // Reload events from DB
      const dbEvents = await getEvents(selectedYear, selectedMonth, sortColumn, sortDirection);
      setEvents(dbEvents);
      if (result.lastSyncedAt) {
        setLastSyncedAt(new Date(result.lastSyncedAt));
      }
      if (force) alert('Sync completed successfully!');
    } catch (err) {
      const errorMsg = `Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
      setError(errorMsg);
      if (force) alert(errorMsg);
    } finally {
      setSyncing(false);
      setSyncStatus('idle');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const getFileIcon = (type: S3File['type']): string => {
    switch (type) {
      case 'video': return '🎥';
      case 'json': return '📄';
      case 'json.gz': return '📦';
      case 'jpg': return '🖼️';
      default: return '📁';
    }
  };

  const getMonthName = (monthNum: string): string => {
    return new Date(2000, parseInt(monthNum) - 1).toLocaleString('default', { month: 'long' });
  };

  const handleSort = (column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🚪 Geoffrey - Digital Doorman</h1>
        <p>Browse user-submitted feedback from S3</p>
      </header>

      <main className="main">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="controls">
          <div className="current-date">
            <span className="date-label">Viewing:</span>
            <span className="date-value">
              {selectedYear && selectedMonth
                ? `${getMonthName(selectedMonth)} ${selectedYear}`
                : 'Loading...'}
            </span>
          </div>
          <div className="control-buttons">
            <button
              className="date-picker-button"
              onClick={() => setShowDatePicker(!showDatePicker)}
            >
              📅 Change Date
            </button>
            <button
              className="sync-button"
              onClick={() => handleSync(true)}
              disabled={syncing || !selectedYear || !selectedMonth}
              title="Force sync events from S3"
            >
              {syncing ? '⏳ Syncing...' : '🔄 Force Sync'}
            </button>
            {lastSyncedAt && (
              <span className="last-synced">
                Last synced: {lastSyncedAt.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {syncing && (
          <div className="sync-overlay">
            <div className="sync-spinner"></div>
            <p>Syncing events from S3... This may take a moment.</p>
          </div>
        )}

        {showDatePicker && (
          <div className="date-picker">
            <div className="date-picker-section">
              <h3>Year</h3>
              <div className="date-picker-buttons">
                {years.map(year => (
                  <button
                    key={year}
                    className={`date-picker-btn ${selectedYear === year ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedYear(year);
                      setSelectedMonth(null);
                    }}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>

            {selectedYear && months.length > 0 && (
              <div className="date-picker-section">
                <h3>Month</h3>
                <div className="date-picker-buttons">
                  {months.map(month => (
                    <button
                      key={month}
                      className={`date-picker-btn ${selectedMonth === month ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedMonth(month);
                        setShowDatePicker(false);
                      }}
                    >
                      {getMonthName(month)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="events-section">
          <h2>
            📂 Events {selectedYear && selectedMonth && `(${events.length} total)`}
          </h2>
          {loading ? (
            <p>Loading...</p>
          ) : events.length === 0 ? (
            <div className="empty-state">
              <p>No events found in local database.</p>
              <p>{syncing ? 'Syncing from S3...' : 'Waiting for sync...'}</p>
            </div>
          ) : (
            <>
              <div className="events-table-container">
                <table className="events-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th onClick={() => handleSort('eventId')} className="sortable">
                        Event ID {sortColumn === 'eventId' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('userId')} className="sortable">
                        User ID {sortColumn === 'userId' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('deviceId')} className="sortable">
                        Device {sortColumn === 'deviceId' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('timestamp')} className="sortable">
                        Date/Time {sortColumn === 'timestamp' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('fileCount')} className="sortable">
                        Files {sortColumn === 'fileCount' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => {
                      const isExpanded = expandedEvent === event.eventId;
                      const isDownloaded = downloadedEvents.has(event.eventId);
                      const isDownloading = downloadingEvents.has(event.eventId);
                      const video = event.files.find((f: S3File) => f.type === 'video');

                      const handleDownload = async (eventId: string) => {
                        if (!selectedYear || !selectedMonth) return;

                        setDownloadingEvents(prev => new Set(prev).add(eventId));
                        try {
                          await downloadEvent(selectedYear, selectedMonth, eventId);
                          setDownloadedEvents(prev => new Set(prev).add(eventId));
                        } catch (err) {
                          alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                        } finally {
                          setDownloadingEvents(prev => {
                            const next = new Set(prev);
                            next.delete(eventId);
                            return next;
                          });
                        }
                      };

                      const handleDelete = async () => {
                        if (!selectedYear || !selectedMonth) return;

                        try {
                          await deleteDownload(selectedYear, selectedMonth, event.eventId);
                          setDownloadedEvents(prev => {
                            const next = new Set(prev);
                            next.delete(event.eventId);
                            return next;
                          });
                        } catch (err) {
                          alert('Delete failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
                        }
                      };

                      return (
                        <>
                          <tr key={event.eventId} className={isExpanded ? 'expanded' : ''}>
                            <td className="expand-cell">
                              <button
                                className="expand-btn"
                                onClick={() => setExpandedEvent(isExpanded ? null : event.eventId)}
                              >
                                {isExpanded ? '▼' : '▶'}
                              </button>
                            </td>
                            <td className="event-id">{event.eventId}</td>
                            <td>{event.userId}</td>
                            <td>
                              <div className="device-info">
                                <div className="device-model">{event.cameraModel}</div>
                                <div className="device-id">{event.deviceId}</div>
                              </div>
                            </td>
                            <td>{event.timestamp.toLocaleString()}</td>
                            <td>
                              <div className="file-count-breakdown">
                                <span className="total">{event.fileCount}</span>
                                {event.fileTypes.video > 0 && <span className="file-type-badge video">🎥 {event.fileTypes.video}</span>}
                                {event.fileTypes.jpg > 0 && <span className="file-type-badge jpg">🖼️ {event.fileTypes.jpg}</span>}
                                {event.fileTypes.json > 0 && <span className="file-type-badge json">📄 {event.fileTypes.json}</span>}
                                {event.fileTypes.jsonGz > 0 && <span className="file-type-badge json-gz">📦 {event.fileTypes.jsonGz}</span>}
                              </div>
                            </td>
                            <td>
                              {isDownloading ? (
                                <span className="status-badge downloading">Downloading...</span>
                              ) : isDownloaded ? (
                                <span className="status-badge downloaded">✓ Downloaded</span>
                              ) : (
                                <span className="status-badge not-downloaded">Not Downloaded</span>
                              )}
                            </td>
                            <td className="actions-cell">
                              {isDownloading ? null : isDownloaded ? (
                                <button className="btn-delete" onClick={handleDelete}>Delete</button>
                              ) : (
                                <button className="btn-download" onClick={() => handleDownload(event.eventId)}>⬇ Download</button>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="expanded-row">
                              <td colSpan={8}>
                                <div className="event-details">
                                  {isDownloaded && video && selectedYear && selectedMonth && (
                                    <div className="video-player">
                                      <video
                                        controls
                                        src={getLocalFileUrl(selectedYear, selectedMonth, event.eventId, video.key.split('/').pop() || '')}
                                        style={{ width: '100%', maxHeight: '400px' }}
                                      >
                                        Your browser does not support video playback.
                                      </video>
                                    </div>
                                  )}

                                  <div className="file-list">
                                    <h4>Files ({event.files.length})</h4>
                                    {event.files.map((file: S3File) => {
                                      const originalFilename = file.key.split('/').pop() || '';
                                      // Remove .gz extension for downloaded files (they're decompressed locally)
                                      const displayFilename = isDownloaded && originalFilename.endsWith('.gz')
                                        ? originalFilename.replace('.gz', '')
                                        : originalFilename;

                                      return (
                                        <div key={file.key} className="file-item">
                                          <span className="file-icon">{getFileIcon(file.type)}</span>
                                          <span className="file-name">{displayFilename}</span>
                                          <span className="file-size">{formatFileSize(file.size)}</span>
                                          {isDownloaded && selectedYear && selectedMonth && (
                                            <a
                                              href={getLocalFileUrl(selectedYear, selectedMonth, event.eventId, displayFilename)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="file-link"
                                            >
                                              View Local
                                            </a>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main >
    </div >
  );
}

export default App;
