import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import recruitmentService from '../../services/recruitmentService';
import '../../styles/Recruitments.css';

const RecruitmentsPage = () => {
  const { user } = useAuth();
  const [recruitments, setRecruitments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');

  useEffect(() => {
    fetchRecruitments();
  }, [filter]);

  const fetchRecruitments = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter !== 'all') params.status = filter;

      const response = await recruitmentService.list(params);
      // ✅ Fixed: recruitmentService.list already returns response.data
      setRecruitments(response.data?.recruitments || []);
    } catch (error) {
      console.error('Error fetching recruitments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'open': return 'badge-success';
      case 'closing_soon': return 'badge-warning';
      case 'closed': return 'badge-error';
      default: return 'badge-info';
    }
  };

  const getDaysRemaining = (endDate) => {
    const now = new Date();
    const end = new Date(endDate);
    const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  };

  return (
    <Layout>
      <div className="recruitments-page">
        <div className="page-header">
          <div>
            <h1>Club Recruitments</h1>
            <p>Apply to join your favorite clubs</p>
          </div>
        </div>

        {/* Filters */}
        <div className="filters-section">
          <div className="filter-buttons">
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={`filter-btn ${filter === 'open' ? 'active' : ''}`}
              onClick={() => setFilter('open')}
            >
              Open
            </button>
            <button
              className={`filter-btn ${filter === 'closing_soon' ? 'active' : ''}`}
              onClick={() => setFilter('closing_soon')}
            >
              Closing Soon
            </button>
            <button
              className={`filter-btn ${filter === 'closed' ? 'active' : ''}`}
              onClick={() => setFilter('closed')}
            >
              Closed
            </button>
          </div>
        </div>

        {/* Recruitments List */}
        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading recruitments...</p>
          </div>
        ) : recruitments.length > 0 ? (
          <div className="recruitments-grid">
            {recruitments.map((recruitment) => {
              const daysRemaining = getDaysRemaining(recruitment.endDate);
              const isOpen = recruitment.status === 'open' || recruitment.status === 'closing_soon';

              return (
                <div key={recruitment._id} className="recruitment-card">
                  <div className="recruitment-header">
                    <div>
                      <h3>{recruitment.title}</h3>
                      <p className="club-name">{recruitment.club?.name || 'Unknown Club'}</p>
                    </div>
                    <span className={`badge ${getStatusBadgeClass(recruitment.status)}`}>
                      {recruitment.status}
                    </span>
                  </div>

                  <p className="recruitment-description">{recruitment.description}</p>

                  <div className="recruitment-meta">
                    <div className="meta-item">
                      <span className="meta-icon">📅</span>
                      <span>
                        {new Date(recruitment.startDate).toLocaleDateString()} - {new Date(recruitment.endDate).toLocaleDateString()}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="meta-item">
                        <span className="meta-icon">⏰</span>
                        <span className={daysRemaining <= 2 ? 'text-warning' : ''}>
                          {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
                        </span>
                      </div>
                    )}
                    {recruitment.positions && recruitment.positions > 0 && (
                      <div className="meta-item">
                        <span className="meta-icon">👥</span>
                        <span>{recruitment.positions} position{recruitment.positions !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>

                  {recruitment.eligibility && (
                    <div className="eligibility">
                      <strong>Eligibility:</strong> {recruitment.eligibility}
                    </div>
                  )}

                  <div className="recruitment-actions">
                    <Link to={`/recruitments/${recruitment._id}`} className="btn btn-outline">
                      View Details
                    </Link>
                    {isOpen && user?.roles?.global === 'student' && (
                      <Link to={`/recruitments/${recruitment._id}`} className="btn btn-primary">
                        Apply Now
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="no-results">
            <p>No recruitments found</p>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className="btn btn-outline">
                View All Recruitments
              </button>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default RecruitmentsPage;
