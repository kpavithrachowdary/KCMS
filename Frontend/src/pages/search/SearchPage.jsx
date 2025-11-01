import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import searchService from '../../services/searchService';
import { FaSearch, FaUsers, FaBuilding, FaCalendarAlt, FaFile } from 'react-icons/fa';
import '../../styles/Search.css';

function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState({ clubs: [], events: [], users: [], documents: [] });
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim()) {
      performSearch();
    }
  }, [query]);

  const performSearch = async () => {
    try {
      setLoading(true);
      const response = await searchService.globalSearch(query, { limit: 20 });
      
      setResults(response.data || { clubs: [], events: [], users: [], documents: [] });
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) {
      setSearchParams({ q: query });
      performSearch();
    }
  };

  const getTotalResults = () => {
    return (results.clubs?.length || 0) + 
           (results.events?.length || 0) + 
           (results.users?.length || 0) + 
           (results.documents?.length || 0);
  };

  return (
    <Layout>
      <div className="search-page">
        <div className="search-header">
          <h1>Search</h1>
          <form onSubmit={handleSearch} className="search-form-large">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for clubs, events, users..."
              autoFocus
            />
            <button type="submit" className="btn btn-primary">
              <FaSearch /> Search
            </button>
          </form>
        </div>

        {query && (
          <>
            <div className="search-tabs">
              <button
                className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                onClick={() => setActiveTab('all')}
              >
                All ({getTotalResults()})
              </button>
              <button
                className={`tab-btn ${activeTab === 'clubs' ? 'active' : ''}`}
                onClick={() => setActiveTab('clubs')}
              >
                <FaBuilding /> Clubs ({results.clubs?.length || 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`}
                onClick={() => setActiveTab('events')}
              >
                <FaCalendarAlt /> Events ({results.events?.length || 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
                onClick={() => setActiveTab('users')}
              >
                <FaUsers /> Users ({results.users?.length || 0})
              </button>
              <button
                className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
                onClick={() => setActiveTab('documents')}
              >
                <FaFile /> Documents ({results.documents?.length || 0})
              </button>
            </div>

            <div className="search-results">
              {loading ? (
                <div className="loading">Searching...</div>
              ) : getTotalResults() === 0 ? (
                <div className="empty-state">
                  <FaSearch className="empty-icon" />
                  <h3>No Results Found</h3>
                  <p>Try different keywords or check spelling</p>
                </div>
              ) : (
                <>
                  {/* Clubs */}
                  {(activeTab === 'all' || activeTab === 'clubs') && results.clubs?.length > 0 && (
                    <div className="results-section">
                      <h2><FaBuilding /> Clubs</h2>
                      <div className="results-grid">
                        {results.clubs.map(club => (
                          <div 
                            key={club._id} 
                            className="result-card"
                            onClick={() => navigate(`/clubs/${club._id}`)}
                          >
                            <h3>{club.name}</h3>
                            <p className="category">{club.category}</p>
                            <p className="description">{club.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Events */}
                  {(activeTab === 'all' || activeTab === 'events') && results.events?.length > 0 && (
                    <div className="results-section">
                      <h2><FaCalendarAlt /> Events</h2>
                      <div className="results-grid">
                        {results.events.map(event => (
                          <div 
                            key={event._id} 
                            className="result-card"
                            onClick={() => navigate(`/events/${event._id}`)}
                          >
                            <h3>{event.title}</h3>
                            <p className="date">
                              {new Date(event.date).toLocaleDateString()}
                            </p>
                            <p className="description">{event.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Users */}
                  {(activeTab === 'all' || activeTab === 'users') && results.users?.length > 0 && (
                    <div className="results-section">
                      <h2><FaUsers /> Users</h2>
                      <div className="results-list">
                        {results.users.map(user => (
                          <div key={user._id} className="result-item">
                            <div className="user-avatar">
                              {user.profile?.name?.charAt(0) || 'U'}
                            </div>
                            <div className="user-info">
                              <h4>{user.profile?.name || user.email}</h4>
                              <p>{user.profile?.department} • Year {user.profile?.year}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Documents */}
                  {(activeTab === 'all' || activeTab === 'documents') && results.documents?.length > 0 && (
                    <div className="results-section">
                      <h2><FaFile /> Documents</h2>
                      <div className="results-list">
                        {results.documents.map(doc => (
                          <div key={doc._id} className="result-item">
                            <FaFile className="doc-icon" />
                            <div className="doc-info">
                              <h4>{doc.filename}</h4>
                              <p>{doc.description || 'No description'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

export default SearchPage;
