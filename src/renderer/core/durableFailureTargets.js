(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SproutgDurableFailureTargets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function upper(value) {
    return text(value).toUpperCase();
  }

  function positiveRow(value) {
    const row = Number(value);
    return Number.isInteger(row) && row > 0 ? row : 0;
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  function encodeTuple(namespace, values) {
    const parts = (Array.isArray(values) ? values : [values]).map(text);
    return `${text(namespace)}:${JSON.stringify(parts)}`;
  }

  function rowFallback(payload) {
    return encodeTuple('row', [positiveRow(payload && payload.row) || 'missing']);
  }

  function o1Identity(payload) {
    const profileName = text(payload && payload.identity && payload.identity.profileName);
    return profileName ? encodeTuple('profile', [profileName]) : rowFallback(payload);
  }

  function mccIdentity(payload) {
    const profileName = text(payload && payload.identity && payload.identity.profileName);
    const accountName = text(payload && payload.identity && payload.identity.accountName);
    return profileName && accountName
      ? encodeTuple('profile-account', [profileName, accountName])
      : rowFallback(payload);
  }

  function passIdentity(payload) {
    const identity = payload && payload.identity;
    const hasExpected = !!(
      identity
      && typeof identity === 'object'
      && (
        Object.prototype.hasOwnProperty.call(identity, 'expectedValue')
        || Object.prototype.hasOwnProperty.call(identity, 'fios')
        || Object.prototype.hasOwnProperty.call(identity, 'value')
      )
    );
    if (!hasExpected) return rowFallback(payload);
    const expected = identity.expectedValue ?? identity.fios ?? identity.value;
    return encodeTuple('expected', [expected]);
  }

  function o1OwnerKey(value) {
    const input = value && typeof value === 'object' ? value : {};
    const profileName = text(
      input.profileName
      || input.profile
      || (input.identity && input.identity.profileName)
    );
    if (profileName) return encodeTuple('o1-profile', [profileName]);
    const tabKey = text(input.tabKey);
    return tabKey && !tabKey.startsWith('O1#')
      ? encodeTuple('o1-tab', [tabKey])
      : '';
  }

  function mccOwnerKey(value) {
    const input = value && typeof value === 'object' ? value : {};
    const identity = input.identity && typeof input.identity === 'object'
      ? input.identity
      : input;
    const profileName = text(identity.profileName || identity.profile);
    const accountName = text(identity.accountName || identity.account);
    return profileName && accountName
      ? encodeTuple('mcc-account', [profileName, accountName])
      : '';
  }

  function cellStateKey(namespace, ownerKey, col) {
    const owner = text(ownerKey);
    const column = upper(col);
    return owner && column
      ? encodeTuple('cell-state', [namespace, owner, column])
      : '';
  }

  function smsProfileStateKey(service, ownerKey) {
    const owner = text(ownerKey);
    const provider = text(service);
    return owner && provider
      ? encodeTuple('sms-profile-state', [provider, owner])
      : '';
  }

  function editDraftKey(scope, ownerParts, col) {
    const owners = Array.isArray(ownerParts) ? ownerParts : [ownerParts];
    const column = upper(col);
    return text(scope) && owners.length && column
      ? encodeTuple('edit-draft', [scope, ...owners, column])
      : '';
  }

  function one(action, target, payload) {
    return {
      key: `${action}:${target}`,
      action,
      payload
    };
  }

  function entries(actionValue, payloadValue) {
    const action = text(actionValue);
    const payload = payloadValue && typeof payloadValue === 'object'
      ? payloadValue
      : {};

    if (action === 'o1.updateCells' || action === 'mcc.updateCells') {
      const identity = action.startsWith('mcc.') ? mccIdentity(payload) : o1Identity(payload);
      const updates = payload.updates && typeof payload.updates === 'object' && !Array.isArray(payload.updates)
        ? payload.updates
        : {};
      return Object.keys(updates)
        .map((sourceCol) => ({ sourceCol, col:upper(sourceCol) }))
        .filter((item) => item.col)
        .sort((a, b) => a.col.localeCompare(b.col))
        .filter((item, index, list) => index === 0 || item.col !== list[index - 1].col)
        .map(({ sourceCol, col }) => one(action, `${identity}:col:${col}`, {
          ...payload,
          updates: { [col]: updates[sourceCol] }
        }));
    }

    if (action === 'pass.updateCell') {
      const col = upper(payload.col);
      return [one(action, `${passIdentity(payload)}:col:${col || 'missing'}`, payload)];
    }

    if (action === 'o1.toggleDeleted') {
      return [one(action, o1Identity(payload), payload)];
    }
    if (action === 'o1.setNumber') {
      return [one(action, `${o1Identity(payload)}:group:${text(payload.group) || 'missing'}`, payload)];
    }
    if (action === 'mcc.setUnderReviewBg' || action === 'mcc.toggleAccountDeleted') {
      return [one(action, mccIdentity(payload), payload)];
    }
    if (action === 'mcc.updateProfileName') {
      const oldProfileName = text(
        payload.oldProfileName
        || (payload.identity && payload.identity.profileName)
      );
      return [one(action, encodeTuple('profile', [oldProfileName || 'missing']), payload)];
    }
    if (action === 'mcc.toggleProfileDeleted') {
      return [one(action, encodeTuple('profile', [text(payload.profileName) || 'missing']), payload)];
    }
    if (action === 'company.addRow') {
      const values = Array.isArray(payload.values) ? payload.values : [];
      return [one(action, encodeTuple('company', [text(values[0]) || 'missing']), payload)];
    }

    return [one(action, stableStringify(payload), payload)];
  }

  function normalizeRecords(records) {
    const latest = new Map();
    for (const record of (Array.isArray(records) ? records : [])) {
      if (!record || typeof record !== 'object') continue;
      const updatedAt = Number(record.updatedAt || 0);
      for (const target of entries(record.action, record.payload)) {
        const previous = latest.get(target.key);
        if (previous && Number(previous.updatedAt || 0) > updatedAt) continue;
        latest.set(target.key, {
          ...record,
          ...target,
          updatedAt
        });
      }
    }
    return Array.from(latest.values());
  }

  return {
    cellStateKey,
    editDraftKey,
    encodeTuple,
    entries,
    mccOwnerKey,
    normalizeRecords,
    o1OwnerKey,
    smsProfileStateKey,
    stableStringify
  };
});
