function smsOwnedOptions(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    ...input,
    ownerIdentity:{
      profileName:String(input.ownerIdentity?.profileName || '').trim()
    }
  };
}

const SMS_POOL_ORDER_SPEC = {
  action:'smspool.orderO1',
  payload:([options])=>smsOwnedOptions(options)
};
const SMS_POOL_CHECK_SPEC = {
  action:'smspool.checkO1',
  payload:([orderId, options])=>({ ...smsOwnedOptions(options), orderId })
};
const SMS_POOL_REFUND_SPEC = {
  action:'smspool.refundO1',
  payload:([orderId, options])=>({ ...smsOwnedOptions(options), orderId })
};
const SMS_POOL_STATE_SPEC = {
  action:'smspool.stateO1',
  payload:([options])=>smsOwnedOptions(options)
};

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
  'o1.proxyFields',
  'mcc.profile',
  'mcc.overview',
  'mcc.lists',
  'mcc.stageList',
  'mcc.workList',
  'mcc.verificationPools',
  'mcc.proxyFields',
  'apell.index',
  'pass.lookupFios',
  'pass.catalog',
  'company.formMeta',
  'company.checkDuplicate',
  'smspool.balanceO1',
  'herosms.balanceO1'
]);

const LEGACY_TO_ACTION = {
  findProfile: { action: 'o1.profileByName', payload: ([profileName]) => ({ profileName }) },
  getProfileByRow: { action: 'o1.profileByRow', payload: ([row, identity]) => ({ row, identity }) },
  getO1AppealRowData: { action: 'o1.appealRow', payload: ([row, identity]) => ({ row, identity }) },
  getProfilesByRows: { action: 'o1.profilesByRows', payload: ([rows]) => ({ rows }) },
  listProfilesForCleanup: { action: 'o1.cleanupList', payload: ([limit]) => ({ limit }) },
  listProfilesByGroupDate: {
    action: 'o1.groupDateList',
    payload: ([group, fromIso, toIso, limit]) => ({ group, fromIso, toIso, limit })
  },
  getWorkLists: { action: 'o1.workLists', payload: ([mode, fromIso, toIso]) => ({ mode, fromIso, toIso }) },
  updateCell: { action: 'o1.updateCells', payload: ([row, col, value, identity]) => ({ row, updates: { [String(col || '').toUpperCase()]: value }, identity }) },
  updateCells: { action: 'o1.updateCells', payload: ([row, updates, identity]) => ({ row, updates, identity }) },
  updateProxyFromValue: { action: 'o1.proxyFields', payload: ([row, value, identity]) => ({ row, value, identity }) },
  toggleProfileDeleted: { action: 'o1.toggleDeleted', payload: ([row, enabled, identity]) => ({ row, enabled, identity }) },
  setGroupNumber: { action: 'o1.setNumber', payload: ([row, group, enabled, identity]) => ({ row, group, enabled, identity }) },

  getMccProfile: { action: 'mcc.profile', payload: ([profileName]) => ({ profileName }) },
  listMccProfilesByStageDate: {
    action: 'mcc.stageList',
    payload: ([stage, fromIso, toIso, limit]) => ({ stage, fromIso, toIso, limit })
  },
  getMccWorkFilter: { action: 'mcc.workList', payload: ([mode, limit]) => ({ mode, limit }) },
  getMccProfilesOverview: { action: 'mcc.overview', payload: ([limit]) => ({ limit }) },
  getMccVerificationDropdownPools: { action: 'mcc.verificationPools', payload: () => ({}) },
  updateMccCell: { action: 'mcc.updateCells', payload: ([row, col, value, identity]) => ({ row, updates: { [String(col || '').toUpperCase()]: value }, identity }) },
  updateMccCells: { action: 'mcc.updateCells', payload: ([row, updates, identity]) => ({ row, updates, identity }) },
  mccSetUnderReviewBg: { action: 'mcc.setUnderReviewBg', payload: ([row, identity]) => ({ row, identity }) },
  updateMccProxyFromValue: { action: 'mcc.proxyFields', payload: ([row, value, identity]) => ({ row, value, identity }) },
  updateMccProfileName: { action: 'mcc.updateProfileName', payload: ([rows, value, oldProfileName]) => ({ rows, value, oldProfileName }) },
  toggleMccProfileDeleted: { action: 'mcc.toggleProfileDeleted', payload: ([profileName, enabled]) => ({ profileName, enabled }) },
  toggleMccAccountDeleted: { action: 'mcc.toggleAccountDeleted', payload: ([row, enabled, identity]) => ({ row, enabled, identity }) },

  getApellDataIndex: { action: 'apell.index', payload: ([options]) => (options || {}) },
  getPassLookupForFios: { action: 'pass.lookupFios', payload: ([fios]) => ({ fios }) },
  getPassCatalog: { action: 'pass.catalog', payload: ([geos]) => ({ geos }) },
  updatePassCell: { action: 'pass.updateCell', payload: ([row, col, value, identity]) => ({ row, col, value, identity }) },
  getCompanyFormMeta: { action: 'company.formMeta', payload: () => ({}) },
  addCompanyRow: { action: 'company.addRow', payload: ([values]) => ({ values }) },

  smsPoolOrderO1: SMS_POOL_ORDER_SPEC,
  smsPoolCheckO1: SMS_POOL_CHECK_SPEC,
  smsPoolRefundO1: SMS_POOL_REFUND_SPEC,
  smsPoolGetStateO1: SMS_POOL_STATE_SPEC,
  smspoolOrderO1: SMS_POOL_ORDER_SPEC,
  smspoolCheckO1: SMS_POOL_CHECK_SPEC,
  smspoolRefundO1: SMS_POOL_REFUND_SPEC,
  smspoolGetStateO1: SMS_POOL_STATE_SPEC,
  smspoolBalanceO1: { action: 'smspool.balanceO1', payload: () => ({}) },
  heroSmsOrderO1: { action: 'herosms.orderO1', payload: ([options]) => smsOwnedOptions(options) },
  heroSmsCheckO1: { action: 'herosms.checkO1', payload: ([orderId, options]) => ({ ...smsOwnedOptions(options), orderId }) },
  heroSmsRefundO1: { action: 'herosms.refundO1', payload: ([orderId, options]) => ({ ...smsOwnedOptions(options), orderId }) },
  heroSmsGetStateO1: { action: 'herosms.stateO1', payload: ([options]) => smsOwnedOptions(options) },
  heroSmsBalanceO1: { action: 'herosms.balanceO1', payload: () => ({}) }
};

function isReadAction(action) {
  return READ_ACTIONS.has(String(action || ''));
}

module.exports = {
  READ_ACTIONS,
  LEGACY_TO_ACTION,
  isReadAction
};
