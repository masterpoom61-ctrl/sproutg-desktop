(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.SproutWorkSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  function normalize(value){
    if(!value || !['O1', 'MCC'].includes(value.page)) return null;
    const profile = String(value.profile || '').trim();
    const row = Number(value.row);
    if(!profile || profile.length > 1000 || !Number.isSafeInteger(row) || row < 1) return null;
    const offset = (n)=>Number.isFinite(Number(n)) ? Math.max(0, Math.min(Number(n), 10000000)) : 0;
    return { page:value.page, profile, row:String(row), account:String(value.account || '').trim().slice(0,1000),
      scrollTop:offset(value.scrollTop), scrollLeft:offset(value.scrollLeft) };
  }
  function matches(snapshot, context){
    return !!snapshot && snapshot.page === context?.page && snapshot.profile === context?.profile;
  }
  return { normalize, matches };
});
