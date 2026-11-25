// Executed in a reporting tab by the Windows Server worker.
async function recheckPage(spec, rules) {
  const url = new URL(location.href);
  if (url.origin !== 'https://ads.google.com' || url.pathname.replace(/\/$/, '') !== spec.path ||
      url.searchParams.get('ocid') !== spec.ocid || !/^en\b/i.test(document.documentElement.lang)) return {wait:true};
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const text = e => clean(e?.innerText ?? e?.textContent);
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' &&
    !e.closest('[hidden],[aria-hidden=true],[inert]');
  const all = (root, selector) => Array.from(root.querySelectorAll(selector)).filter(visible);
  const labels = e => [e.getAttribute('aria-label'), e.title, text(e)].map(clean).filter(Boolean);
  const headerSel = 'th,[role=columnheader],ess-table-head-cell';
  const rowSel = 'tr,[role=row],ess-table-row';
  const cellSel = 'td,[role=cell],[role=gridcell],ess-table-cell';
  const headings = 'h1,h2,h3,h4,[role=heading]';
  const controls = 'button,[role=button],material-button,material-dropdown-select,[role=option],material-select-item,material-list-item,a';
  const ids = s => [...new Set(clean(s).match(/\b\d{3}-\d{3}-\d{4}\b/g) || [])];
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const describe = e => [e.localName,e.getAttribute('essfield'),e.className?.toString().slice(0,85),
    e.getAttribute('aria-label'), e.title, text(e).slice(0,110)].filter(Boolean).join(' | ');
  const navId = () => {
    const selected=all(document,'mcc-nav-slim .operating-customer .id,mcc-nav-slim nav-popup-trigger mcc-nav-breadcrumb .account-id-bottom').flatMap(e=>ids(text(e)));
    return [...new Set(selected.length?selected:all(document,'mcc-nav-breadcrumb').flatMap(e=>ids(text(e))))];
  };
  const inspectEditor=spec.action==='inspect' && spec.screen==='campaigns' && Boolean(spec.campaign);
  if (spec.action === 'inspect' && !inspectEditor) {
    const headers = all(document,headerSel);
    if (spec.screen==='inventory' && !headers.length) return {wait:true};
    if (spec.screen!=='inventory' && !all(document,headings).map(text).some(Boolean)) return {wait:true};
    if (spec.screen!=='inventory') await sleep(1800);
    if (spec.screen==='policy' && /submit your documents/i.test(text(document.querySelector('advertiser-verification-view')))) {
      await until(()=>all(document,'notification-bar .notification-container').length,'Notification still loading.',9000).catch(()=>null);
    }
    if (spec.screen==='policy' && /pay with your payment method/i.test(text(document.querySelector('advertiser-verification-view')))) {
      await until(()=>all(document,'html-notification-renderer').some(e=>rules.paymentWarning(text(e))),'Payment notice still loading.',12000).catch(()=>null);
    }
    if (['campaigns','ads'].includes(spec.screen) && !all(document,'[role=gridcell][essfield="primary_status"]').some(e=>text(e))) return {wait:true};
    if (spec.screen==='inventory') await sleep(1800);
    const row = all(document,rowSel).find(r=>all(r,cellSel).some(c=>spec.screen==='inventory'?ids(text(c)).length:c.getAttribute('essfield')==='primary_status' && text(c)));
    let periodOptions=[],confirmedPeriod=null;
    if (spec.screen==='inventory') {
      const picker=all(document,'material-date-range-picker .primary-range [role=button]')[0];
      if (picker) {
        const selectedAllTime=text(document.querySelector('material-date-range-picker .range-title'))==='All time';
        picker.click(); await sleep(400);
        periodOptions=all(document,'[role=option],material-select-item,material-list-item,li,button,[role=button],div,span')
          .filter(e=>text(e)==='All time').slice(-6).map(e=>[describe(e),describe(e.parentElement),describe(e.parentElement.parentElement)]);
        if (selectedAllTime) {
          const preset=only(named(document,'material-select-item',/^All time$/i),'All time preset');
          preset.click();
          await until(()=>!visible(preset) && text(document.querySelector('material-date-range-picker .range-title'))==='All time',
            'The All time preset did not close the menu.');
          confirmedPeriod='All time';
        }
      }
    }
    return {screen:spec.screen, language:document.documentElement.lang, path:url.pathname,
      periodOptions,confirmedPeriod,
      headings:all(document,headings).map(text).filter(Boolean).slice(0,15), selected:navId(),
      headers:headers.map(e=>[e.getAttribute('essfield'),text(e)]).slice(0,45),
      tasks:all(document,'verification-task-item .task-title-text').map(text),
      notifications:all(document,'notifications-bar').map(bar=>({
        controls:all(bar,'[aria-label],[title],button,[role=button],material-icon').map(describe).slice(0,18),
        counters:all(bar,'span,div').filter(e=>/^\d+\s*\/\s*\d+$/.test(text(e))).slice(-3)
          .map(e=>[describe(e),describe(e.parentElement)]),
        banners:all(bar,'.notification-container').map(e=>({severity:e.classList.contains('alert-outline')?'alert':e.className,
          message:text(e.querySelector('.notification-text')).slice(0,220)}))
      })),
      row:row?cells(row).map(e=>[e.getAttribute('essfield'),text(e).slice(0,110)]):[],
      pager:all(document,'pagination-bar').map(text)};
  }
  async function until(read, message, ms=30000) {
    const end=Date.now()+ms;
    do { const result=read(); if (result) return result; await sleep(250); } while (Date.now()<end);
    throw Error(message);
  }
  function only(items,what) {
    if (items.length!==1) throw Error(what+' ('+items.length+').');
    return items[0];
  }
  function named(root,selector,re) {
    const nodes=all(root,selector).filter(e=>labels(e).some(s=>re.test(s)) && !e.closest('[disabled],[aria-disabled=true]'));
    return nodes.filter(e=>!nodes.some(other=>other!==e && e.contains(other)));
  }
  const dates=()=>all(document,'material-date-range-picker').find(e=>all(e,'.range-title,.primary-range').length);
  const allTime=()=>text(dates()?.querySelector('.range-title'))==='All time';
  async function setAllTime() {
    const picker=await until(dates,'Date range picker missing.');
    if (allTime()) return false;
    only(all(picker,'.primary-range [role=button]'),'Date selector').click();
    const option=await until(()=>named(document,'[role=option],material-select-item,material-list-item,li,button,[role=button],.preset,.range-option',/^All time$/i)[0],
      'Cannot find All time in the date picker.');
    option.click();
    let applied=false;
    await until(()=>{
      if (allTime()) return true;
      const apply=named(document,'button,[role=button],material-button',/^Apply$/i);
      if (!applied && apply.length===1) { applied=true; apply[0].click(); }
      return false;
    },'Google Ads did not apply All time.');
    return true;
  }
  function getTable(column) {
    const header=all(document,headerSel).find(e=>e.getAttribute('essfield')===column);
    return header?.closest('ess-table,[role=table],[role=grid],table');
  }
  function cells(row) { return all(row,cellSel); }
  function labeledCell(row,field) { return cells(row).find(c=>c.getAttribute('essfield')===field); }
  const readLabels = e => e ? [text(e), ...all(e,'[title],[aria-label]').flatMap(labels)].join(' ') : '';
  function pagerOf(table) {
    const scoped=all(table,'pagination-bar');
    return (scoped.length?scoped:all(document,'pagination-bar'))[0];
  }
  function range(pager) {
    const m=/\b([\d,]+)\s*[-–]\s*([\d,]+)\s+of\s+([\d,]+)\b/i.exec(text(pager));
    return m && m.slice(1).map(v=>Number(v.replace(/,/g,'')));
  }
  async function allPages(table,readRow) {
    const pager=await until(()=>pagerOf(table),'Missing table pagination.');
    const anyRange=()=>range(pager) || (/\b0 of 0\b|(?:No|Zero) results/i.test(text(pager))?[0,0,0]:null);
    let current=await until(anyRange,'No record count in pagination.');
    const turn=async(re,before)=>{
      only(named(pager,controls+',material-fab',re),'Pagination control').click();
      return until(()=>{const n=anyRange();return n && n[0]!==before && n;},'Page did not change.');
    };
    if (current[0]>1) current=await turn(/first page|^first_page$/i,current[0]);
    const total=current[2], result=new Map();
    if (total===0) return [];
    let first=1;
    while (first<=total) {
      if (current[0]!==first || current[2]!==total) throw Error('Table total or page order changed during recheck.');
      const expected=current[1]-first+1, seen=new Map();
      const scan=()=>{
        for (const row of all(table,rowSel)) {
          const item=readRow(row);
          if (item) {
            if (seen.has(item.key) && JSON.stringify(seen.get(item.key))!==JSON.stringify(item)) throw Error('Row changed while reading '+item.key);
            seen.set(item.key,item);
          }
        }
      };
      // Google Ads lazy-loads metrics and virtualizes rows on large pages.
      await sleep(400);
      let scroller=pager.parentElement;
      while (scroller && !(scroller.scrollHeight>scroller.clientHeight+10 && /auto|scroll|overlay/.test(getComputedStyle(scroller).overflowY))) scroller=scroller.parentElement;
      scroller ||= document.scrollingElement;
      const deadline=Date.now()+60000;
      do {
        scan();
        if (seen.size===expected) break;
        const height=Math.max(160,scroller.clientHeight*.75), bottom=scroller.scrollHeight-scroller.clientHeight;
        for (let pos=0;pos<=bottom+height && seen.size<expected;pos+=height) {
          scroller.scrollTo({top:Math.min(bottom,pos),behavior:'instant'});
          await sleep(190); scan();
        }
        if (seen.size<expected) await sleep(400);
      } while (Date.now()<deadline && seen.size<expected);
      if (seen.size!==expected) throw Error('Read '+seen.size+' of '+expected+' complete rows (page starts at '+first+').');
      for (const [key,value] of seen) {
        if (result.has(key)) throw Error('Duplicate row across pages: '+key);
        result.set(key,value);
      }
      first=current[1]+1;
      if (first<=total) current=await turn(/next page|^chevron_right$/i,current[0]);
    }
    return Array.from(result.values());
  }
  if (spec.action==='inventory') {
    const manager=navId();
    if (manager.length!==1 || !document.title.endsWith(' - '+spec.profile+' - Google Ads')) return {wait:true};
    if (await setAllTime()) return {reloadForPeriod:true};
    const table=await until(()=>getTable('customer_info.descriptive_name'),'Missing Performance table.');
    for (const field of ['stats.cost','customer_info.ui_account_status','customer_manager_info.direct_manager_column','account_setting_type'])
      if (!all(table,headerSel).some(e=>e.getAttribute('essfield')===field)) throw Error('Missing Performance column '+field);
    const inventory=await allPages(table,row=>{
      const acct=labeledCell(row,'customer_info.descriptive_name'), type=text(labeledCell(row,'account_setting_type'));
      if (!acct || !type) return null;
      const cid=ids(readLabels(acct));
      if (cid.length!==1 || !acct.querySelector('a')) return null;
      const key=cid[0],direct=labeledCell(row,'customer_manager_info.direct_manager_column');
      if (type!=='Google Ads' || !ids(readLabels(direct)).includes(manager[0])) return {key,skip:true};
      const anchor=acct.querySelector('a.account-cell-link,a[href*="ocid="]');
      const account=text(anchor), raw=text(labeledCell(row,'stats.cost'));
      if (!anchor || !raw) return null;
      if (!/^\d{1,5}$/.test(account)) throw Error('Account name is not a SproutG number: '+account);
      const target=new URL(anchor.getAttribute('href'),location.href);
      if (target.origin!==url.origin || !/^\d+$/.test(target.searchParams.get('ocid')) || target.searchParams.get('ocid')===spec.ocid)
        throw Error('Missing account link for '+account);
      const status=labeledCell(row,'customer_info.ui_account_status');
      const icon=status?.querySelector('.aw-status');
      if (!icon) return null;
      const active=icon.classList.contains('enabled') || labels(icon).some(s=>/^(Enabled|Active)$/i.test(s));
      if (!active && !/paused|suspended|draft|cancel|closed|inactive|disabled|pending|removed|not.?enabled/i.test(describe(icon)))
        throw Error('Unknown account status for '+account+': '+describe(icon));
      const currencyCell=cells(row).find(e=>/currency/.test(e.getAttribute('essfield')||''));
      if (currencyCell && !/^(?:USD|US dollars?|United States dollars?|US\$|\$|US dollars? \(USD\))$/i.test(text(currencyCell)))
        throw Error('Unexpected currency for '+account);
      return {key,account,customerId:key,link:target.href,active,cost:rules.usd(raw),currency:'USD',
        currencySource:currencyCell?'column':/USD|\$/.test(raw)?'cost':'profile setting'};
    });
    if (!allTime() || navId()[0]!==manager[0]) throw Error('Period or manager changed while reading Performance.');
    const rows=inventory.filter(r=>!r.skip);
    if (new Set(rows.map(r=>r.account)).size!==rows.length) throw Error('Two child accounts have the same SproutG number.');
    return {period:'All time',manager:manager[0],rows,skipped:inventory.length-rows.length};
  }
  if (navId().length!==1 || navId()[0]!==spec.customerId) return {wait:true};
  async function readNotifications(paymentTask) {
    const host=await until(()=>document.querySelector('notifications-bar'),'Account notifications did not load.');
    const banners=()=>all(host,'notification-bar .notification-container');
    const first=await until(()=>banners().find(e=>text(e.querySelector('.notification-text'))),'Payment notice did not load.',
      paymentTask?15000:3500).catch(()=>null);
    if (!first) {
      if (paymentTask) throw Error('Payment task is visible but the amount notice did not load.');
      return [];
    }
    const position=()=>{
      const counter=all(host,'.pagination-index')[0];
      if (!counter) return [1,1];
      const match=/^(\d+)\s*\/\s*(\d+)$/.exec(text(counter));
      if (!match) throw Error('Unknown account-notification counter.');
      return match.slice(1).map(Number);
    };
    const [start,total]=position();
    const move=async(index,direction)=>{
      only(named(host,controls,direction==='next'?/^Next notification$/i:/^Previous notification$/i),'Notification navigation').click();
      await until(()=>{const [now,count]=position();return now===index && count===total;},'The notification did not change.',8500);
      await sleep(250);
    };
    for(let i=start;i>1;i--) await move(i-1,'previous');
    const list=[];
    for(let i=1;i<=total;i++) {
      const active=await until(()=>banners().find(e=>text(e.querySelector('.notification-text'))),'Notification text missing.');
      const message=text(active.querySelector('.notification-text'));
      list.push({message,red:active.classList.contains('alert-outline') || active.classList.contains('alert')});
      if (i<total) await move(i+1,'next');
    }
    return list;
  }
  if (spec.action==='policy') {
    const view=await until(()=>all(document,'advertiser-verification-view').find(e=>/completed tasks|complete the tasks|get verified|advertiser verification is complete/i.test(text(e))),'Advertiser verification did not load.');
    await sleep(400);
    const tasks=all(view,'verification-task-item').filter(e=>named(e,controls,/^Start task(?: for .*)?$/i).length || !/answered|provided|confirmed|completed/i.test(text(e)));
    const titles=tasks.map(e=>text(e.querySelector('.task-title-text'))).filter(Boolean);
    const paymentTask=titles.some(s=>/^Pay with your payment method$/i.test(s));
    const notices=await readNotifications(paymentTask);
    const payment=notices.filter(n=>n.red && rules.paymentWarning(n.message)).map(n=>n.message);
    const hasPay=paymentTask || payment.length>0;
    const documentTasks=tasks.filter(e=>/^Submit your documents$/i.test(text(e.querySelector('.task-title-text'))));
    const pendingUnknown=titles.filter(s=>!/^Confirm your affiliation with the organization$|^Pay with your payment method$|^Submit your documents$|^(?:You.ve|You have) /i.test(s));
    const otherPayment=notices.some(n=>!n.red && rules.paymentWarning(n.message)) && !hasPay;
    const blocked=notices.some(n=>/account (?:is |has been )?(?:paused|suspended)|ads (?:aren.t|are not) running/i.test(n.message));
    if (!titles.length && !/completed tasks|advertiser verification is complete/i.test(text(view))) throw Error('Empty or unknown verification panel.');
    let prepay=null,verification=null;
    if (hasPay) prepay=rules.paymentAmount(payment);
    if (documentTasks.length) {
      const task=only(documentTasks,'Submit your documents tasks');
      only(named(task,controls,/^Start task(?: for Submit your documents)?$/i),'Document task details').click();
      const panel=await until(()=>{
        const nodes=all(document,'[role=dialog],material-drawer,material-dialog,drawer,slide-out-drawer,verification-task-view,[class*=drawer-content]');
        return nodes.reverse().find(e=>/personal details|passport|registration document|driver.s license/i.test(text(e))) ||
          all(document,'iframe').find(e=>{try{return /personal details|passport|registration document/i.test(text(e.contentDocument?.body));}catch{return false;}});
      },'Document details not recognized. Visible panels: '+all(document,'iframe,[role=dialog],material-drawer').map(e=>e.localName+(e.src?' '+new URL(e.src,location.href).hostname:'')).join(', '),10000).catch(()=>null);
      if (panel) verification=rules.documentStatus(text(panel.localName==='iframe'?panel.contentDocument.body:panel));
      else {
        const bodyText=text(document.body);
        try { verification=rules.documentStatus(bodyText); } catch {
          return {prepay,verification:null,clear:false,documentPending:true,review:null};
        }
      }
    }
    const recognized=titles.length>0 || /advertiser verification (?:is )?complete|identity verified/i.test(text(view));
    return {prepay,verification,clear:recognized && !prepay && !verification && !blocked && !otherPayment && !pendingUnknown.length,
      review:pendingUnknown.length?'Other verification task: '+pendingUnknown.join(', '):!recognized?'No recognized verification result':
        otherPayment?'Payment notification requires review':blocked && !prepay && !verification?'Account paused or suspended':null};
  }
  function columnText(row,field) { return text(labeledCell(row,field)); }
  function campaignLink(cell) {
    if (!cell) return null;
    for (const a of all(cell,'a[href]')) {
      const href=new URL(a.href,location.href);
      const id=href.searchParams.get('campaignId');
      if (href.origin===url.origin && /^\d+$/.test(id || '')) return {id,name:text(a)};
    }
    const anchors=all(cell,'campaign-name a.ess-cell-link');
    const name=anchors.length===1?text(anchors[0]):'';
    return name?{id:'name:'+name,name}:null;
  }
  function endOfCampaign(row) {
    const explicit=labeledCell(row,'end_date');
    if (explicit) {
      const iso=rules.dateISO(text(explicit));
      if (iso) return iso;
      if (/no end date|^—$/i.test(text(explicit))) return 'none';
    }
    const budget=labeledCell(row,'budget_amount');
    if (!budget) return null;
    const dateStrings=[text(budget),...all(budget,'[aria-label],[title]').flatMap(labels)];
    for (const s of dateStrings) {
      const dates=[...s.matchAll(/\b(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+\d{1,2},?\s+\d{4}\b/gi)].map(m=>rules.dateISO(m[0]));
      if (dates.length>=2 && dates[0] && dates[1]) return dates[1];
      if (/no end date/i.test(s)) return 'none';
    }
    return null;
  }
  const videoType = value => /\bvideo\b|TrueView|YouTube/i.test(value);
  if (['campaigns','ads','extend'].includes(spec.action) || inspectEditor) {
    const adScreen=spec.action==='ads';
    if (await setAllTime()) return {reloadForPeriod:true};
    const table=await until(()=>getTable(adScreen?'ad':'name'),'Missing '+spec.screen+' table.');
    const readRow=row=>{
      const nameCell=labeledCell(row,adScreen?'campaign_name':'name');
      if (!nameCell) return null;
      const link=campaignLink(nameCell);
      if (!link) return null;
      const status=columnText(row,'primary_status');
      if (!status) return null;
      if (!adScreen) {
        const kind=columnText(row,'advertising_channel_type');
        if (!kind) return null;
        return {key:link.id,id:link.id,name:link.name,status,video:videoType(kind),endDate:endOfCampaign(row)};
      }
      const ad=labeledCell(row,'ad'), kind=columnText(row,'ad.visible_type');
      if (!ad || !kind) return null;
      const group=columnText(row,'ad_group_name');
      const rowId=row.getAttribute('data-row-id') || row.getAttribute('row-id') ||
        all(ad,'a[href]').map(e=>new URL(e.href,location.href).searchParams.get('adId')).find(Boolean);
      const adName=text(ad);
      return {key:JSON.stringify([link.id,rowId || [group,adName]]),campaignId:link.id,status,video:videoType(kind) || !!columnText(row,'ad.video_ad.video_title') && columnText(row,'ad.video_ad.video_title')!=='—'};
    };
    const rows=await allPages(table,readRow);
    if (adScreen) {
      for (const ad of rows.filter(a=>a.video && /^not eligible\b/i.test(a.status) && !/disapproved/i.test(a.status))) {
        const mounted=all(table,rowSel).find(r=>readRow(r)?.key===ad.key);
        if (!mounted) continue;
        const target=labeledCell(mounted,'primary_status')?.querySelector('[tooltiptarget]');
        if (!target) continue;
        target.scrollIntoView({block:'center'});
        target.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        target.dispatchEvent(new MouseEvent('mouseenter'));
        await sleep(700);
        const advice=all(document,'[role=tooltip],material-tooltip,material-popup').map(text).join(' ');
        if (/\bdisapproved\b/i.test(advice)) ad.status='Disapproved';
        target.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));
      }
    }
    if (navId()[0]!==spec.customerId || !allTime()) throw Error('Child account or reporting period changed.');
    if (spec.action!=='extend' && !inspectEditor) return {rows};
    const current=only(rows.filter(c=>c.id===spec.campaign && c.video),'Matching video campaign');
    const campaignRow=only(all(table,rowSel).filter(r=>campaignLink(labeledCell(r,'name'))?.id===spec.campaign),'Campaign editor row');
    if (inspectEditor) return await editEndDate(campaignRow,current);
    if (current.endDate===spec.newDate) return {confirmed:true,endDate:current.endDate};
    if (current.endDate!==spec.endDate || !(current.endDate<spec.today) || spec.newDate!==rules.nextWeek(spec.today)) throw Error('Campaign end date changed since review.');
    return await editEndDate(campaignRow,current);
  }
  async function editEndDate(row,current) {
    row.scrollIntoView({block:'center'});
    row.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    only(named(row,controls,/^Edit settings$/i),'Edit settings for this video campaign').click();
    const budgetToggle=()=>named(document,'[aria-expanded][role=button]',/^Budget and dates$/i)[0];
    const toggle=await until(budgetToggle,'Campaign budget and dates did not load.');
    function sameCampaign() {
      const names=all(document,headings).map(text).filter(s=>s.startsWith('Campaign name '));
      return location.pathname==='/aw/settings/campaign/video' && navId().length===1 && navId()[0]===spec.customerId &&
        new URL(location.href).searchParams.get('ocid')===spec.ocid && names.length===1 &&
        names[0].slice('Campaign name '.length).replace(/\s+expand_(?:less|more)$/,'')===current.name;
    }
    if (!sameCampaign()) throw Error('The campaign name or customer ID in settings does not match the Performance row.');
    function summaryEnd() {
      const summary=text(budgetToggle()?.closest('[role=heading]'));
      return rules.dateISO(/\bEnd:\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/i.exec(summary)?.[1]);
    }
    if (summaryEnd()!==current.endDate) throw Error('Settings and campaign table show different end dates.');
    if (toggle.getAttribute('aria-expanded')==='false') toggle.click();
    const section=await until(()=>document.getElementById(toggle.getAttribute('aria-controls')),'Budget section missing.');
    const editDates=await until(()=>named(section,controls,/^Edit budget dates$/i)[0],'Edit budget dates is missing.');
    editDates.click();
    const endPicker=()=>all(section,'end-date-picker [aria-haspopup=dialog]').find(e=>/^Select an end date/i.test(e.getAttribute('aria-label')));
    const picker=await until(endPicker,'End date picker not found.');
    const pickerDate=()=>rules.dateISO(endPicker()?.getAttribute('aria-label')?.replace(/^Select an end date\s*/i,''));
    if (pickerDate()!==current.endDate) throw Error('The end date control disagrees with the saved settings.');
    picker.click();
    const dialog=await until(()=>all(document,'[role=dialog][aria-label="Date Picker"]').find(e=>all(e,'material-calendar-picker').length),'End-date calendar did not open.');
    const target=inspectEditor?current.endDate:spec.newDate;
    const utc=new Date(target+'T12:00:00Z');
    const format=(locale,month)=>new Intl.DateTimeFormat(locale,{year:'numeric',month,day:'numeric',timeZone:'UTC'}).format(utc);
    const label=format('en-GB','long');
    const daySlot=()=>all(dialog,'.day-slot[aria-label]').find(e=>clean(e.getAttribute('aria-label')).split(',')[0]===label);
    let slot=daySlot();
    if (!slot) {
      // The calendar renders only nearby months. Its date input can jump to a distant end date.
      const input=only(all(dialog,'input:not([disabled]):not([readonly])'),'Date input');
      if (rules.dateISO(input.value)!==current.endDate) throw Error('Calendar input shows an unexpected date.');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,format('en-US','short'));
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await sleep(250);
      slot=daySlot();
      if (!slot && visible(dialog)) input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
    }
    if (slot) {
      if (slot.closest('[aria-disabled=true],[disabled]') || slot.classList.contains('disabled')) throw Error('The requested end date is disabled.');
      slot.click();
    }
    await until(()=>!visible(dialog) && pickerDate()===target,'The campaign form did not accept the selected end date.',7000);
    if (inspectEditor) return {editor:'Budget and dates',endDate:target,calendarConfirmed:true};
    if (!sameCampaign() || !allTime()) throw Error('Account, campaign or reporting period changed before Save.');
    only(named(section,controls,/^Save$/i),'Save end date').click();
    await until(()=>summaryEnd()===target,'Save outcome uncertain. Re-read the campaign end date.',20000);
    return {confirmed:true,endDate:target};
  }
  throw Error('Unrecognized recheck step.');
}
