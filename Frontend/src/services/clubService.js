import api from './api';

const clubService = {
  // Create Club (Admin only)
  createClub: async (formData) => {
    const response = await api.post('/clubs', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  // List Clubs
  listClubs: async (params = {}) => {
    const response = await api.get('/clubs', { params });
    return response.data;
  },

  // Get Club Details
  getClub: async (clubId) => {
    const response = await api.get(`/clubs/${clubId}`);
    return response.data;
  },

  // Update Club Settings
  updateSettings: async (clubId, data) => {
    const response = await api.patch(`/clubs/${clubId}/settings`, data);
    return response.data;
  },

  // Approve Protected Settings (Coordinator only)
  approveSettings: async (clubId, approvalData) => {
    const response = await api.post(`/clubs/${clubId}/settings/approve`, approvalData);
    return response.data;
  },

  // Reject Protected Settings (Coordinator only)
  rejectSettings: async (clubId) => {
    const response = await api.post(`/clubs/${clubId}/settings/reject`);
    return response.data;
  },

  // Archive Club (with reason)
  archiveClub: async (clubId, data) => {
    const response = await api.delete(`/clubs/${clubId}`, { data });
    return response.data;
  },

  // Approve/Reject Archive Request (Coordinator only)
  approveArchiveRequest: async (clubId, data) => {
    const response = await api.post(`/clubs/${clubId}/archive/approve`, data);
    return response.data;
  },

  // Restore Archived Club (Admin only)
  restoreClub: async (clubId) => {
    const response = await api.post(`/clubs/${clubId}/restore`);
    return response.data;
  },

  // Get Club Analytics
  getAnalytics: async (clubId, params = {}) => {
    const response = await api.get(`/clubs/${clubId}/analytics`, { params });
    return response.data;
  },

  // Upload Club Banner
  uploadBanner: async (clubId, file) => {
    const formData = new FormData();
    formData.append('banner', file);
    const response = await api.post(`/clubs/${clubId}/banner`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  // Get Club Members
  getMembers: async (clubId, params = {}) => {
    const response = await api.get(`/clubs/${clubId}/members`, { params });
    return response.data;
  },

  // Add Member to Club
  addMember: async (clubId, data) => {
    const response = await api.post(`/clubs/${clubId}/members`, data);
    return response.data;
  },

  // Update Member Role
  updateMemberRole: async (clubId, memberId, data) => {
    const response = await api.patch(`/clubs/${clubId}/members/${memberId}`, data);
    return response.data;
  },

  // Remove Member from Club
  removeMember: async (clubId, memberId) => {
    const response = await api.delete(`/clubs/${clubId}/members/${memberId}`);
    return response.data;
  },

  // Approve Member (update status to 'approved')
  approveMember: async (clubId, memberId) => {
    const response = await api.patch(`/clubs/${clubId}/members/${memberId}`, { status: 'approved' });
    return response.data;
  },

  // Reject Member (update status to 'rejected')
  rejectMember: async (clubId, memberId) => {
    const response = await api.patch(`/clubs/${clubId}/members/${memberId}`, { status: 'rejected' });
    return response.data;
  },

  // Get Public Stats for Homepage (no auth required)
  getPublicStats: async () => {
    const response = await api.get('/clubs/public/stats');
    return response.data;
  },
};

export default clubService;
