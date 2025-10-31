import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import recruitmentService from '../../services/recruitmentService';
import userService from '../../services/userService';
import '../../styles/Recruitments.css';

const RecruitmentDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recruitment, setRecruitment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [myClubsCount, setMyClubsCount] = useState(0);
  const [applicationData, setApplicationData] = useState({
    whyJoin: '',
    skills: '',
    experience: '',
    customAnswers: {},
  });

  useEffect(() => {
    fetchRecruitmentDetails();
    fetchMyClubs();
  }, [id]);

  const fetchRecruitmentDetails = async () => {
    try {
      const response = await recruitmentService.getById(id);
      // ✅ FIX: Axios returns full response object
      // Structure: response.data = { status, data: { recruitment } }
      setRecruitment(response.data?.data?.recruitment || response.data?.recruitment);
    } catch (error) {
      console.error('Error fetching recruitment details:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMyClubs = async () => {
    try {
      const response = await userService.getMyClubs();
      setMyClubsCount(response.data?.clubs?.length || 0);
    } catch (error) {
      console.error('Error fetching clubs:', error);
    }
  };

  const handleChange = (e) => {
    setApplicationData({
      ...applicationData,
      [e.target.name]: e.target.value,
    });
  };

  const handleCustomAnswerChange = (questionId, value) => {
    setApplicationData({
      ...applicationData,
      customAnswers: {
        ...applicationData.customAnswers,
        [questionId]: value,
      },
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApplying(true);

    try {
      // Transform frontend format to backend format
      // Backend expects: { answers: [{ question, answer }] }
      const answers = [
        { question: 'Why do you want to join this club?', answer: applicationData.whyJoin },
        { question: 'Relevant Skills', answer: applicationData.skills },
      ];
      
      // Add experience if provided (optional field)
      if (applicationData.experience && applicationData.experience.trim()) {
        answers.push({ question: 'Previous Experience', answer: applicationData.experience });
      }
      
      // Add custom questions answers
      if (recruitment.customQuestions && recruitment.customQuestions.length > 0) {
        recruitment.customQuestions.forEach((question, index) => {
          const answer = applicationData.customAnswers[index] || '';
          if (answer.trim()) {
            answers.push({ question, answer });
          }
        });
      }
      
      await recruitmentService.apply(id, { answers });
      alert('Application submitted successfully!');
      navigate('/recruitments');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to submit application');
    } finally {
      setApplying(false);
    }
  };

  // Status management handlers
  const handleSchedule = async () => {
    if (!window.confirm('Schedule this recruitment? It will be visible to students and will auto-open on the start date.')) {
      return;
    }
    
    try {
      await recruitmentService.changeStatus(id, 'schedule');
      alert('Recruitment scheduled successfully! It will open on ' + new Date(recruitment.startDate).toLocaleDateString());
      fetchRecruitmentDetails(); // Reload to show updated status
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to schedule recruitment');
    }
  };

  const handleOpen = async () => {
    if (!window.confirm('Open this recruitment now? All students will be notified and can start applying.')) {
      return;
    }
    
    try {
      await recruitmentService.changeStatus(id, 'open');
      alert('Recruitment opened successfully! Students can now apply.');
      fetchRecruitmentDetails(); // Reload to show updated status
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to open recruitment');
    }
  };

  const handleClose = async () => {
    if (!window.confirm('Close this recruitment? No more applications will be accepted.')) {
      return;
    }
    
    try {
      await recruitmentService.changeStatus(id, 'close');
      alert('Recruitment closed successfully! You can now review applications.');
      fetchRecruitmentDetails(); // Reload to show updated status
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to close recruitment');
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading recruitment details...</p>
        </div>
      </Layout>
    );
  }

  if (!recruitment) {
    return (
      <Layout>
        <div className="error-container">
          <h2>Recruitment not found</h2>
          <button onClick={() => navigate('/recruitments')} className="btn btn-primary">
            Back to Recruitments
          </button>
        </div>
      </Layout>
    );
  }

  const isOpen = recruitment.status === 'open' || recruitment.status === 'closing_soon';
  
  // ✅ Use backend-provided permission flags (SINGLE SOURCE OF TRUTH)
  const canManage = recruitment?.canManage || false;
  const hasApplied = recruitment?.hasApplied || false;
  const userApplication = recruitment?.userApplication;

  return (
    <Layout>
      <div className="recruitment-detail-page">
        <div className="recruitment-detail-header">
          <div>
            <h1>{recruitment.title}</h1>
            <p className="club-name-large">{recruitment.club?.name || 'Unknown Club'}</p>
          </div>
          <span className={`badge badge-lg badge-${
            recruitment.status === 'open' ? 'success' : 
            recruitment.status === 'closing_soon' ? 'warning' : 'error'
          }`}>
            {recruitment.status}
          </span>
        </div>

        <div className={`recruitment-detail-content ${(isOpen && !canManage && !hasApplied) ? 'two-column' : 'single-column'}`}>
          <div className="recruitment-info-section">
            <div className="info-card">
              <h3>About This Recruitment</h3>
              <p>{recruitment.description}</p>
            </div>

            <div className="info-card">
              <h3>Details</h3>
              <div className="detail-row">
                <span className="detail-label">Start Date:</span>
                <span>{new Date(recruitment.startDate).toLocaleDateString()}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">End Date:</span>
                <span>{new Date(recruitment.endDate).toLocaleDateString()}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Positions Available:</span>
                <span>
                  {(() => {
                    if (typeof recruitment.positions === 'number') {
                      return recruitment.positions;
                    } else if (Array.isArray(recruitment.positions) && recruitment.positions.length > 0) {
                      return recruitment.positions.length;
                    } else {
                      return 'Not specified';
                    }
                  })()}
                </span>
              </div>
              {recruitment.eligibility && (
                <div className="detail-row">
                  <span className="detail-label">Eligibility:</span>
                  <span>{recruitment.eligibility}</span>
                </div>
              )}
            </div>

            {canManage && (
              <div className="info-card">
                <h3>Manage Recruitment</h3>
                <div className="management-actions" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  
                  {/* Status Management Buttons */}
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {recruitment.status === 'draft' && (
                      <button 
                        onClick={handleSchedule}
                        className="btn btn-success"
                        style={{ flex: '1', minWidth: '150px' }}
                      >
                        📅 Schedule Recruitment
                      </button>
                    )}
                    
                    {recruitment.status === 'scheduled' && (
                      <button 
                        onClick={handleOpen}
                        className="btn btn-success"
                        style={{ flex: '1', minWidth: '150px' }}
                      >
                        ✅ Open Now
                      </button>
                    )}
                    
                    {(recruitment.status === 'open' || recruitment.status === 'closing_soon') && (
                      <button 
                        onClick={handleClose}
                        className="btn btn-warning"
                        style={{ flex: '1', minWidth: '150px' }}
                      >
                        🔒 Close Recruitment
                      </button>
                    )}
                    
                    {(recruitment.status === 'draft' || recruitment.status === 'scheduled') && (
                      <button 
                        onClick={() => navigate(`/recruitments/${id}/edit`)}
                        className="btn btn-secondary"
                        style={{ flex: '1', minWidth: '150px' }}
                      >
                        ✏️ Edit Details
                      </button>
                    )}
                  </div>
                  
                  {/* View Applications Button */}
                  <button 
                    onClick={() => navigate(`/recruitments/${id}/applications`)}
                    className="btn btn-primary"
                  >
                    📋 View Applications ({recruitment.applicationCount || 0})
                  </button>
                  
                  {/* Status Info */}
                  <div style={{ 
                    padding: '12px', 
                    background: '#f3f4f6', 
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}>
                    <strong>Current Status:</strong> {recruitment.status}
                    {recruitment.status === 'draft' && (
                      <p style={{ margin: '8px 0 0 0', color: '#6b7280' }}>
                        ℹ️ Click "Schedule" to make it visible and ready to open on start date
                      </p>
                    )}
                    {recruitment.status === 'scheduled' && (
                      <p style={{ margin: '8px 0 0 0', color: '#6b7280' }}>
                        ℹ️ Will auto-open on {new Date(recruitment.startDate).toLocaleDateString()} or click "Open Now"
                      </p>
                    )}
                    {recruitment.status === 'open' && (
                      <p style={{ margin: '8px 0 0 0', color: '#059669' }}>
                        ✅ Students can apply until {new Date(recruitment.endDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Show Application Status if user has applied */}
          {hasApplied && !canManage && (
            <div className="info-card" style={{ 
              background: '#f0fdf4', 
              border: '2px solid #22c55e',
              padding: '24px',
              borderRadius: '8px'
            }}>
              <h3 style={{ color: '#16a34a', marginBottom: '12px' }}>
                ✅ Application Submitted
              </h3>
              <p style={{ marginBottom: '16px', color: '#166534' }}>
                You have successfully applied to this recruitment. Your application is currently under review.
              </p>
              <div style={{ 
                display: 'flex', 
                gap: '12px', 
                padding: '12px',
                background: 'white',
                borderRadius: '6px',
                fontSize: '14px'
              }}>
                <div style={{ flex: 1 }}>
                  <strong>Status:</strong> 
                  <span style={{ 
                    marginLeft: '8px',
                    padding: '4px 12px',
                    background: userApplication?.status === 'selected' ? '#dcfce7' : 
                               userApplication?.status === 'rejected' ? '#fee2e2' : '#e0f2fe',
                    color: userApplication?.status === 'selected' ? '#16a34a' : 
                           userApplication?.status === 'rejected' ? '#dc2626' : '#0369a1',
                    borderRadius: '12px',
                    fontSize: '13px',
                    fontWeight: '500'
                  }}>
                    {userApplication?.status || 'submitted'}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <strong>Applied:</strong> {userApplication?.appliedAt ? new Date(userApplication.appliedAt).toLocaleDateString() : 'Recently'}
                </div>
              </div>
              {userApplication?.status === 'selected' && (
                <p style={{ marginTop: '12px', color: '#16a34a', fontWeight: '500' }}>
                  🎉 Congratulations! You have been selected. You are now a member of this club!
                </p>
              )}
              {userApplication?.status === 'rejected' && (
                <p style={{ marginTop: '12px', color: '#dc2626' }}>
                  Unfortunately, your application was not successful this time. Keep trying!
                </p>
              )}
            </div>
          )}

          {isOpen && !canManage && !hasApplied && user?.roles?.global === 'student' && (
            <div className="application-form-section">
              <h2>Apply Now</h2>
              
              {/* 3-Club Limit Warning */}
              {myClubsCount >= 3 ? (
                <div className="alert alert-warning" style={{ marginBottom: '20px', padding: '16px', backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#92400e' }}>⚠️ Maximum Club Limit Reached</h4>
                  <p style={{ margin: 0, color: '#78350f' }}>
                    You are already a member of {myClubsCount} clubs. Students can join a maximum of 3 clubs. 
                    You cannot apply to this recruitment unless you leave one of your current clubs.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="application-form">
                <div className="form-group">
                  <label htmlFor="whyJoin">Why do you want to join this club? *</label>
                  <textarea
                    id="whyJoin"
                    name="whyJoin"
                    value={applicationData.whyJoin}
                    onChange={handleChange}
                    placeholder="Tell us why you're interested (100-300 words)"
                    rows="5"
                    minLength="100"
                    maxLength="300"
                    required
                  />
                  <small className="form-hint">
                    {applicationData.whyJoin.length}/300 characters
                  </small>
                </div>

                <div className="form-group">
                  <label htmlFor="skills">Relevant Skills *</label>
                  <textarea
                    id="skills"
                    name="skills"
                    value={applicationData.skills}
                    onChange={handleChange}
                    placeholder="List your relevant skills"
                    rows="3"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="experience">Previous Experience</label>
                  <textarea
                    id="experience"
                    name="experience"
                    value={applicationData.experience}
                    onChange={handleChange}
                    placeholder="Describe any relevant experience"
                    rows="3"
                  />
                </div>

                {recruitment.customQuestions && recruitment.customQuestions.length > 0 && (
                  <div className="custom-questions">
                    <h3>Additional Questions</h3>
                    {recruitment.customQuestions.map((question, index) => (
                      <div key={index} className="form-group">
                        <label>{question}</label>
                        <textarea
                          value={applicationData.customAnswers[index] || ''}
                          onChange={(e) => handleCustomAnswerChange(index, e.target.value)}
                          placeholder="Your answer"
                          rows="3"
                          required
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="form-actions">
                  <button
                    type="button"
                    onClick={() => navigate('/recruitments')}
                    className="btn btn-outline"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    disabled={applying || myClubsCount >= 3}
                    title={myClubsCount >= 3 ? 'You have reached the maximum club limit (3 clubs)' : ''}
                  >
                    {applying ? 'Submitting...' : myClubsCount >= 3 ? 'Maximum Clubs Reached' : 'Submit Application'}
                  </button>
                </div>
              </form>
              )}
            </div>
          )}

          {!isOpen && !canManage && (
            <div className="info-card">
              <h3>Applications Closed</h3>
              <p>This recruitment is no longer accepting applications.</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default RecruitmentDetailPage;
