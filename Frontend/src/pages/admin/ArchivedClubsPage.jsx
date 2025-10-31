import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import clubService from '../../services/clubService';
import { getClubLogoUrl, getClubLogoPlaceholder } from '../../utils/imageUtils';
import '../../styles/Clubs.css';
import './ArchivedClubsPage.css';

const ArchivedClubsPage = () => {
  const { user } = useAuth();
  const [archivedClubs, setArchivedClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(null);

  useEffect(() => {
    fetchArchivedClubs();
  }, []);

  const fetchArchivedClubs = async () => {
    try {
      setLoading(true);
      setError('');
      // Note: Backend needs to support status filter or separate archived endpoint
      const response = await clubService.listClubs({ status: 'archived', limit: 100 });
      setArchivedClubs(response.data?.clubs || []);
    } catch (err) {
      console.error('Error fetching archived clubs:', err);
      setError('Failed to load archived clubs');
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreClub = async (clubId, clubName) => {
    if (!window.confirm(`🔄 Are you sure you want to restore "${clubName}"?\n\nThis will make the club active again.`)) {
      return;
    }

    try {
      setRestoring(clubId);
      setError('');
      await clubService.restoreClub(clubId);
      alert(`✅ Club "${clubName}" has been restored successfully!`);
      // Remove from list or refresh
      setArchivedClubs(archivedClubs.filter(club => club._id !== clubId));
    } catch (err) {
      console.error('Error restoring club:', err);
      setError(err.response?.data?.message || `Failed to restore "${clubName}"`);
      alert(`❌ ${err.response?.data?.message || 'Failed to restore club'}`);
    } finally {
      setRestoring(null);
    }
  };

  // Only admins can access this page
  if (user?.roles?.global !== 'admin') {
    return (
      <Layout>
        <div className="error-container">
          <h2>Access Denied</h2>
          <p>You do not have permission to view archived clubs.</p>
          <Link to="/dashboard" className="btn btn-primary">Back to Dashboard</Link>
        </div>
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout>
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading archived clubs...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="archived-clubs-page">
        <div className="page-header">
          <div>
            <h1>🗄️ Archived Clubs</h1>
            <p>Manage and restore archived clubs</p>
          </div>
          <Link to="/admin/dashboard" className="btn btn-secondary">
            ← Back to Admin Dashboard
          </Link>
        </div>

        {error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}

        {archivedClubs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📦</div>
            <h2>No Archived Clubs</h2>
            <p>There are currently no archived clubs in the system.</p>
            <Link to="/clubs" className="btn btn-primary">View Active Clubs</Link>
          </div>
        ) : (
          <div className="archived-clubs-grid">
            {archivedClubs.map((club) => (
              <div key={club._id} className="archived-club-card">
                <div className="club-card-header">
                  <div className="club-logo">
                    {getClubLogoUrl(club) ? (
                      <img src={getClubLogoUrl(club)} alt={club.name} />
                    ) : (
                      <div className="club-logo-placeholder">
                        {getClubLogoPlaceholder(club)}
                      </div>
                    )}
                  </div>
                  <span className="badge badge-warning">Archived</span>
                </div>

                <div className="club-card-body">
                  <h3>{club.name}</h3>
                  <span className="club-category">{club.category}</span>
                  <p className="club-description">{club.description}</p>

                  <div className="club-meta">
                    <div className="meta-item">
                      <span className="meta-icon">👥</span>
                      <span>{club.memberCount || 0} Members</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-icon">👨‍🏫</span>
                      <span>{club.coordinator?.profile?.name || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="club-card-actions">
                  <button
                    onClick={() => handleRestoreClub(club._id, club.name)}
                    className="btn btn-success"
                    disabled={restoring === club._id}
                    style={{ width: '100%' }}
                  >
                    {restoring === club._id ? (
                      <>
                        <span className="spinner-small"></span> Restoring...
                      </>
                    ) : (
                      <>🔄 Restore Club</>
                    )}
                  </button>
                </div>

                {club.archivedAt && (
                  <div className="club-archived-info">
                    <small>
                      Archived: {new Date(club.archivedAt).toLocaleDateString()}
                    </small>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="page-footer">
          <div className="stats-summary">
            <div className="stat-card">
              <div className="stat-value">{archivedClubs.length}</div>
              <div className="stat-label">Total Archived</div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default ArchivedClubsPage;
