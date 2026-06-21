const READ_ACTIONS = new Set([
  'meta.config',
  'dropdown.maps',
  'o1.profileByName',
  'o1.profileByRow',
  'o1.profilesByRows',
  'o1.appealRow',
  'o1.lists',
  'o1.workLists',
  'o1.groupDateList',
  'o1.cleanupList',
  'mcc.profile',
  'mcc.overview',
  'mcc.lists',
  'mcc.stageList',
  'mcc.workList',
  'mcc.verificationPools',
  'apell.index',
  'pass.lookupFios',
  'company.formMeta',
  'smspool.checkO1',
  'smspool.stateO1',
  'smspool.balanceO1'
]);

const LEGACY_TO_ACTION = {
  findProfile: { action: 'o1.profileByName', payload: ([profileName]) => ({ profileName }) },
  getProfileByRow: { action: 'o1.profileByRow', payload: ([row]) => ({ row }) },
  getO1AppealRowData: { action: 'o1.appealRow', payload: ([row]) => ({ row }) },
  getProfilesByRows: { action: 'o1.profilesByRows', payload: ([rows]) => ({ rows }) },
  listProfilesForCleanup: { action: 'o1.cleanupList', payload: ([limit]) => ({ limit }) },
  listProfilesByGroupDate: {
    action: 'o1.groupDateList',
    payload: ([group, fromIso, toIso, limit]) => ({ group, fromIso, toIso, limit })
  },
  getWorkLists: { action: 'o1.workLists', payload: ([mode, fromIso, toIso]) => ({ mode, fromIso, toIso }) },
  updateCell: { action: 'o1.updateCells', payload: ([row, col, value]) => ({ row, updates: { [String(col || '').toUpperCase()]: value } }) },
  updateCells: { action: 'o1.updateCells', payload: ([row, updates]) => ({ row, updates }) },
  updateProxyFromValue: { action: 'o1.proxyFields', payload: ([row, value]) => ({ row, value }) },
  toggleBan: { action: 'o1.toggleBan', payload: ([row, group]) => ({ row, group }) },
  toggleProfileDeleted: { action: 'o1.toggleDeleted', payload: ([row, enabled]) => ({ row, enabled }) },
  setGroupNumber: { action: 'o1.setNumber', payload: ([row, group, enabled]) => ({ row, group, enabled }) },

  getMccProfile: { action: 'mcc.profile', payload: ([profileName]) => ({ profileName }) },
  listMccProfilesByStageDate: {
    action: 'mcc.stageList',
    payload: ([stage, fromIso, toIso, limit]) => ({ stage, fromIso, toIso, limit })
  },
  getMccWorkFilter: { action: 'mcc.workList', payload: ([mode, limit]) => ({ mode, limit }) },
  getMccProfilesOverview: { action: 'mcc.overview', payload: ([limit]) => ({ limit }) },
  getMccVerificationDropdownPools: { action: 'mcc.verificationPools', payload: () => ({}) },
  updateMccCell: { action: 'mcc.updateCells', payload: ([row, col, value]) => ({ row, updates: { [String(col || '').toUpperCase()]: value } }) },
  updateMccCells: { action: 'mcc.updateCells', payload: ([row, updates]) => ({ row, updates }) },
  mccSetUnderReviewBg: { action: 'mcc.setUnderReviewBg', payload: ([row]) => ({ row }) },
  updateMccProxyFromValue: { action: 'mcc.proxyFields', payload: ([row, value]) => ({ row, value }) },
  updateMccProfileName: { action: 'mcc.updateProfileName', payload: ([rows, value]) => ({ rows, value }) },
  toggleMccProfileDeleted: { action: 'mcc.toggleProfileDeleted', payload: ([profileName, enabled]) => ({ profileName, enabled }) },
  toggleMccAccountDeleted: { action: 'mcc.toggleAccountDeleted', payload: ([row, enabled]) => ({ row, enabled }) },

  getApellDataIndex: { action: 'apell.index', payload: ([options]) => (options || {}) },
  getPassLookupForFios: { action: 'pass.lookupFios', payload: ([fios]) => ({ fios }) },
  getCompanyFormMeta: { action: 'company.formMeta', payload: () => ({}) },
  addCompanyRow: { action: 'company.addRow', payload: ([values]) => ({ values }) },

  smspoolOrderO1: { action: 'smspool.orderO1', payload: () => ({}) },
  smspoolCheckO1: { action: 'smspool.checkO1', payload: ([orderId]) => ({ orderId }) },
  smspoolRefundO1: { action: 'smspool.refundO1', payload: ([orderId]) => ({ orderId }) },
  smspoolGetStateO1: { action: 'smspool.stateO1', payload: () => ({}) },
  smspoolBalanceO1: { action: 'smspool.balanceO1', payload: () => ({}) }
};

function isReadAction(action) {
  return READ_ACTIONS.has(String(action || ''));
}

module.exports = {
  READ_ACTIONS,
  LEGACY_TO_ACTION,
  isReadAction
};
