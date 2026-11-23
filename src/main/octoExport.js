const fs = require('node:fs/promises');
const path = require('node:path');

function projectAccounts(profile, requested, data) {
  if (data?.profileName !== profile || !Array.isArray(data.rows)) throw Error('SproutG returned a different profile.');
  if (!Array.isArray(requested) || !requested.length || requested.length > 100 ||
      requested.some(a => typeof a !== 'string' || !/^\d{1,5}$/.test(a)) ||
      new Set(requested).size !== requested.length) throw Error('Expected distinct account numbers.');
  return requested.map(account => {
    const rows = data.rows.filter(row => String(row.accountName).trim() === account);
    if (rows.length !== 1 || rows[0].isDeleted) throw Error('Missing, deleted or ambiguous account: ' + account);
    const link = String(rows[0].values?.J || '').trim();
    const name = String(rows[0].values?.K || '').trim();
    const url = new URL(link);
    if (!name || url.protocol !== 'https:' || !/^(?:youtu\.be|(?:[\w-]+\.)*youtube\.com)$/i.test(url.hostname) ||
        url.username || url.password) throw Error('Invalid campaign data for account ' + account);
    return { account, link, name };
  });
}

async function exportOctoRecords(id, bridge, directory) {
  const base = path.join(directory, id);
  let response;
  try {
    const {profile, accounts} = JSON.parse(await fs.readFile(base + '.request.json', 'utf8'));
    if (typeof profile !== 'string' || !profile.trim() || profile.length > 128) throw Error('Invalid profile.');
    if (!bridge) throw Error('SproutG bridge is not ready.');
    const result = await bridge.callApi('mcc.profile', {profileName:profile}, {timeoutMs:30000});
    if (!result?.ok) throw Error('SproutG profile lookup failed.');
    response = {profile, records:projectAccounts(profile, accounts, result.data)};
  } catch (error) {
    response = {error:error.message};
  }
  await fs.writeFile(base + '.tmp', JSON.stringify(response), {flag:'wx'});
  await fs.rename(base + '.tmp', base + '.response.json');
}

module.exports = { exportOctoRecords, projectAccounts };
