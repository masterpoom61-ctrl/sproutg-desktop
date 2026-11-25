#requires -Version 5.1
[CmdletBinding()]
param([string]$Queue='\\tsclient\Q\', [int]$Port=58000)
$ErrorActionPreference='Stop'
$base="http://127.0.0.1:$Port"
$dir=Join-Path $Queue 'recheck-jobs'
$source=Join-Path $Queue 'recheck-tools'
$ticket=[guid]::NewGuid().ToString()
$state=@{browser=''; profile=''; manager=''; tab=''; inventory=$null; policies=@{}}
$utf8=[Text.UTF8Encoding]::new($false)
function Publish($file,$value) {
    $tmp=$file+'.'+$ticket+'.tmp'
    [IO.File]::WriteAllText($tmp,($value|ConvertTo-Json -Depth 18 -Compress),$utf8)
    if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
    [IO.File]::Move($tmp,$file)
}
function Send-Cdp($ws,[string]$method,$arguments,[switch]$FrameOwner) {
    $wsUri=[uri]$ws
    if ($wsUri.Scheme -ne 'ws' -or !$wsUri.IsLoopback -or $wsUri.Port -ne $Port) { throw 'Unexpected Octo endpoint.' }
    $socket=[Net.WebSockets.ClientWebSocket]::new()
    $cancel=[Threading.CancellationTokenSource]::new(240000)
    try {
        $socket.ConnectAsync($wsUri,$cancel.Token).GetAwaiter().GetResult() | Out-Null
        function Exchange($method,$arguments,$id) {
            $payload=$utf8.GetBytes((@{id=$id;method=$method;params=$arguments}|ConvertTo-Json -Depth 12 -Compress))
            $socket.SendAsync([ArraySegment[byte]]::new($payload),'Text',$true,$cancel.Token).GetAwaiter().GetResult() | Out-Null
            $buffer=[byte[]]::new(16384)
            do {
                $stream=[IO.MemoryStream]::new()
                try {
                    do {
                        $part=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult()
                        if ($part.MessageType -eq 'Close') { throw 'Octo disconnected.' }
                        $stream.Write($buffer,0,$part.Count)
                        if ($stream.Length -gt 4194304) { throw 'Unexpectedly large Octo response.' }
                    } until ($part.EndOfMessage)
                    $reply=$utf8.GetString($stream.ToArray()) | ConvertFrom-Json
                } finally { $stream.Dispose() }
            } until ($reply.id -eq $id)
            if ($reply.error) { throw $reply.error.message }
            return $reply.result
        }
        $first=Exchange $method $arguments 1
        if (!$FrameOwner) { return $first }
        if (!$first.result.objectId) { throw 'Missing unique visible document-requirements frame.' }
        return (Exchange 'DOM.describeNode' @{objectId=$first.result.objectId;depth=0} 2).node.frameId
    } finally { $socket.Dispose(); $cancel.Dispose() }
}
function Discover([string]$profile) {
    $browser=(Invoke-RestMethod "$base/json/version" -TimeoutSec 5).webSocketDebuggerUrl
    $tabs=@(Invoke-RestMethod "$base/json/list" -TimeoutSec 5 | ForEach-Object {$_})
    $suffix=' - '+$profile+' - Google Ads'
    $managerTabs=@($tabs|Where-Object {
        $_.type -eq 'page' -and $_.id -ne $state.tab -and $_.url -match '^https://ads\.google\.com/aw/accounts/?(?:[?#]|$)' -and
        $_.title.EndsWith($suffix,[StringComparison]::Ordinal)
    })
    # A previous worker may have left an audit tab. Only accept duplicate tabs for exactly the same MCC.
    if (!$managerTabs.Count) { throw "Accounts > Performance for '$profile' is not open on port $Port." }
    $keys=@($managerTabs|ForEach-Object { ([Web.HttpUtility]::ParseQueryString(([uri]$_.url).Query))['ocid'] }|Select-Object -Unique)
    if ($keys.Count -ne 1 -or $keys[0] -notmatch '^\d+$') { throw 'Ambiguous manager account.' }
    if ($browser -cne $state.browser -or $profile -cne $state.profile -or $keys[0] -cne $state.manager) {
        $state.browser=$browser; $state.profile=$profile; $state.manager=$keys[0]
        $state.tab=''; $state.inventory=$null; $state.policies=@{}
    }
    return $managerTabs[0]
}
function Ensure-Manager([string]$profile,[bool]$launching) {
    $suffix=' - '+$profile+' - Google Ads'
    $deadline=[datetime]::UtcNow.AddSeconds($(if ($launching) {245} else {8}))
    $opened=$null
    $browser=$null
    do {
        try {
            $browser=(Invoke-RestMethod "$base/json/version" -TimeoutSec 3).webSocketDebuggerUrl
            $tabs=@(Invoke-RestMethod "$base/json/list" -TimeoutSec 3 | ForEach-Object {$_})
        } catch { return @{ready=$false} }
        $same=@($tabs|Where-Object { $_.type -eq 'page' -and $_.url -match '^https://ads\.google\.com/aw/' -and
            $_.title.EndsWith($suffix,[StringComparison]::Ordinal) })
        $performance=@($same|Where-Object { $_.url -match '^https://ads\.google\.com/aw/accounts/?(?:[?#]|$)' })
        if ($performance.Count) {
            if ($opened -and @($performance|Where-Object id -ne $opened).Count) {
                [void](Send-Cdp $browser 'Target.closeTarget' @{targetId=$opened})
            }
            return @{ready=$true}
        }
        if (!$opened -and ($same.Count -or $launching)) {
            $address='https://ads.google.com/aw/accounts?hl=en'
            if ($same.Count) {
                $dest=[UriBuilder]::new($same[0].url)
                $params=[Web.HttpUtility]::ParseQueryString($dest.Query)
                $params.Set('hl','en'); $dest.Path='/aw/accounts'; $dest.Query=$params.ToString(); $dest.Fragment=''
                $address=$dest.Uri.AbsoluteUri
            }
            $opened=(Send-Cdp $browser 'Target.createTarget' @{url=$address;background=$false}).targetId
            $deadline=[datetime]::UtcNow.AddSeconds(180)
        }
        if (!$opened -and !$launching) { return @{ready=$false} }
        Start-Sleep -Seconds 1
    } while ([datetime]::UtcNow -lt $deadline)
    if ($opened) { [void](Send-Cdp $browser 'Target.closeTarget' @{targetId=$opened}) }
    if ($launching) { throw "The authenticated manager '$profile' did not load in Octo." }
    return @{ready=$false}
}
function Audit-Tab($manager,[string]$route,$child) {
    if (!$state.tab) {
        $state.tab=(Send-Cdp $state.browser 'Target.createTarget' @{url='about:blank';background=$true}).targetId
    }
    $tab=@(Invoke-RestMethod "$base/json/list" -TimeoutSec 5 | ForEach-Object {$_} | Where-Object id -eq $state.tab)
    if ($tab.Count -ne 1) { $state.tab=''; throw 'Audit tab was closed. Retry this read.' }
    $dest=[UriBuilder]::new($manager.url)
    $query=[Web.HttpUtility]::ParseQueryString($dest.Query)
    if ($child) {
        $entry=[uri]$child.link
        if ($entry.Scheme -ne 'https' -or $entry.Host -ne 'ads.google.com' -or !$entry.AbsolutePath.StartsWith('/aw/')) { throw 'Account link is not a Google Ads UI link.' }
        $entryQuery=[Web.HttpUtility]::ParseQueryString($entry.Query)
        if ($entryQuery['ocid'] -notmatch '^\d+$' -or $entryQuery['ocid'] -eq $state.manager) { throw 'Missing child account context.' }
        $dest=[UriBuilder]::new($entry); $query=$entryQuery
    }
    $query.Set('hl','en'); $dest.Path=$route; $dest.Query=$query.ToString(); $dest.Fragment=''
    # A fresh document for every step also dismisses old task drawers.
    $navigation=Send-Cdp $tab[0].webSocketDebuggerUrl 'Page.navigate' @{url=$dest.Uri.AbsoluteUri}
    if ($navigation.errorText) { throw $navigation.errorText }
    [void](Send-Cdp $tab[0].webSocketDebuggerUrl 'Page.bringToFront' @{})
    return @{ws=$tab[0].webSocketDebuggerUrl; cid=$query['ocid']; loader=$navigation.loaderId}
}
function Read-Page($tab,$context) {
    $spec=$context|ConvertTo-Json -Depth 10 -Compress
    $code=[IO.File]::ReadAllText((Join-Path $source 'page.js'),$utf8)
    $classifier=[IO.File]::ReadAllText((Join-Path $source 'rules.js'),$utf8)
    $expression="(async()=>{ const module={exports:{}}; $classifier; $code; return await recheckPage($spec,module.exports); })()"
    $deadline=[datetime]::UtcNow.AddSeconds(135)
    $refreshedForPeriod=$false
    do {
        try {
            if ($tab.loader) {
                $frame=(Send-Cdp $tab.ws 'Page.getFrameTree' @{}).frameTree.frame
                if ($frame.loaderId -ne $tab.loader) { Start-Sleep -Milliseconds 400; continue }
            }
            $value=Send-Cdp $tab.ws 'Runtime.evaluate' @{expression=$expression;returnByValue=$true;awaitPromise=$true}
            if ($value.exceptionDetails) { throw (($value.exceptionDetails.exception.description -split "\n")[0]) }
            if ($value.result.value.wait) { Start-Sleep -Milliseconds 500; continue }
            if ($value.result.value.reloadForPeriod) {
                if ($refreshedForPeriod) { throw 'All time did not persist after refreshing the reporting table.' }
                $refreshedForPeriod=$true
                $previous=(Send-Cdp $tab.ws 'Page.getFrameTree' @{}).frameTree.frame.loaderId
                [void](Send-Cdp $tab.ws 'Page.reload' @{})
                do {
                    Start-Sleep -Milliseconds 300
                    $tab.loader=(Send-Cdp $tab.ws 'Page.getFrameTree' @{}).frameTree.frame.loaderId
                } while ((!$tab.loader -or $tab.loader -eq $previous) -and [datetime]::UtcNow -lt $deadline)
                if (!$tab.loader -or $tab.loader -eq $previous) { throw 'Performance did not refresh after the period changed.' }
                continue
            }
            return $value.result.value
        } catch {
            if ($_.Exception.Message -notmatch 'Execution context was destroyed|Cannot find context') { throw }
            Start-Sleep -Milliseconds 500
        }
    } while ([datetime]::UtcNow -lt $deadline)
    throw 'The expected account, English interface or screen did not load.'
}
function Handle($job) {
    if ($job.action -notin @('manager','inspect','inventory','policy','campaigns','ads','extend','finish') -or !$job.profile -or $job.profile.Length -gt 128) { throw 'Invalid recheck operation.' }
    if ($job.action -eq 'manager') { return Ensure-Manager $job.profile ($job.launching -eq $true) }
    $manager=Discover $job.profile
    if ($job.action -eq 'finish') {
        if ($state.tab) { [void](Send-Cdp $state.browser 'Target.closeTarget' @{targetId=$state.tab}); $state.tab='' }
        $state.inventory=$null; $state.policies=@{}
        return @{finished=$true}
    }
    $action=$job.action
    $screen=if ($action -eq 'inspect') { [string]$job.screen } else { $action }
    $routes=@{inventory='/aw/accounts';policy='/aw/policy/account';campaigns='/aw/campaigns';ads='/aw/ads';extend='/aw/campaigns'}
    if (!$routes.ContainsKey($screen)) { throw 'Unsupported inspection screen.' }
    $child=$null
    if ($screen -ne 'inventory') {
        $rows=@($state.inventory.rows|Where-Object { $_.account -ceq $job.account -and $_.customerId -ceq $job.customerId })
        if ($rows.Count -ne 1 -or $rows[0].active -ne $true) { throw 'Active child not found in the confirmed All time inventory.' }
        $child=$rows[0]
    }
    if ($action -eq 'extend') {
        $policy=$state.policies[[string]$job.account]
        if ($child.cost -cne '0.00' -or !$policy -or !$policy.clear -or $child.currency -ne 'USD') { throw 'End date change does not meet recheck conditions.' }
        if ($job.endDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or $job.today -notmatch '^\d{4}-\d{2}-\d{2}$' -or
            $job.newDate -cne ([datetime]::ParseExact($job.today,'yyyy-MM-dd',$null).AddDays(7).ToString('yyyy-MM-dd')) -or $job.endDate -ge $job.today) { throw 'Unexpected campaign date change.' }
    }
    $tab=Audit-Tab $manager $routes[$screen] $child
    $context=@{action=$action;screen=$screen;path=$routes[$screen];ocid=$tab.cid;profile=$state.profile;customerId=$child.customerId;
        campaign=$job.campaign;endDate=$job.endDate;today=$job.today;newDate=$job.newDate}
    if ($action -eq 'inventory') { $state.inventory=$null; $state.policies=@{} }
    $result=Read-Page $tab $context
    if (!$result) { throw 'Empty recheck response.' }
    if ($action -eq 'policy' -and $result.documentPending) {
        try {
            $result.verification=Read-DocumentCategory $tab.ws
            $result.documentPending=$false
        } catch {
            $result | Add-Member -Force -NotePropertyName review -NotePropertyValue ('Document requirements need review. '+$_.Exception.Message)
        }
    }
    if ($action -eq 'inventory' -and $result.period -ceq 'All time') {
        $state.inventory=$result
        $publicRows=@(foreach ($item in $result.rows) {
            @{account=$item.account;customerId=$item.customerId;active=$item.active;cost=$item.cost;currency=$item.currency;currencySource=$item.currencySource}
        })
        return @{period=$result.period;manager=$result.manager;skipped=$result.skipped;rows=$publicRows}
    }
    if ($action -eq 'policy') { $state.policies[[string]$job.account]=$result }
    return $result
}
function Read-DocumentCategory($ws) {
    # Only read the visible requirements in the exact task drawer opened in this child tab.
    $expression='(()=>{const hits=[...document.querySelectorAll(''iframe'')].filter(e=>{const u=new URL(e.src,location.href);return e.getClientRects().length && u.origin==="https://payments.google.com" && u.pathname.split("/").includes("identityverification")});return hits.length===1?hits[0]:null})()'
    $frameId=Send-Cdp $ws 'Runtime.evaluate' @{expression=$expression} -FrameOwner
    try { $ax=Send-Cdp $ws 'Accessibility.getFullAXTree' @{frameId=$frameId} } catch { $ax=$null }
    if (!$ax) {
        $targets=(Send-Cdp $state.browser 'Target.getTargets' @{}).targetInfos
        $frameTarget=@($targets|Where-Object { $_.targetId -ceq $frameId -and $_.type -eq 'iframe' -and
            $_.url -match '^https://payments\.google\.com/[^?#]*/identityverification(?:[/?#]|$)' })
        if ($frameTarget.Count -ne 1) { throw 'Cannot read the document-requirements frame in this tab.' }
        $frameWs="ws://127.0.0.1:$Port/devtools/page/$frameId"
        $ax=Send-Cdp $frameWs 'Accessibility.getFullAXTree' @{}
    }
    $labels=@($ax.nodes|Where-Object { !$_.ignored -and $_.role.value -in @('heading','StaticText','button','listitem') }|ForEach-Object {$_.name.value}) -join ' '
    if ($labels -match '(?i)organization' -and $labels -match '(?i)personal details' -and $labels -match '(?i)provide information for|legal entity you.ll be verifying') { return 'QR' }
    if ($labels -match '(?i)registration document|organization registration|registration certificate|proof of registration' -and $labels -match '(?i)passport|proof of identity|driver.s licen[cs]e') { return 'registration-id' }
    throw 'Document requirements did not match either supported panel.'
}
Add-Type -AssemblyName System.Web
$mutex=[Threading.Mutex]::new($false,'Local\SproutGRecheckReader')
$owned=$false
$reload=$false
$lastCheck=[datetime]::MinValue
try {
    try { $owned=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
    if (!$owned) { return }
    while ($true) {
        try {
            if (!(Test-Path -LiteralPath $Queue -PathType Container)) { Start-Sleep -Seconds 3; continue }
            if (([datetime]::UtcNow-$lastCheck).TotalSeconds -gt 12) {
                $lastCheck=[datetime]::UtcNow
                $package=Join-Path $source 'worker.ps1'
                if ((Get-FileHash -LiteralPath $package).Hash -ne (Get-FileHash -LiteralPath $PSCommandPath).Hash) {
                    if ($state.tab) {
                        try { [void](Send-Cdp $state.browser 'Target.closeTarget' @{targetId=$state.tab}) } catch { Write-Verbose $_.Exception.Message }
                    }
                    Copy-Item -LiteralPath $package -Destination $PSCommandPath -Force
                    $reload=$true
                    break
                }
            }
            [void][IO.Directory]::CreateDirectory($dir)
            Publish (Join-Path $dir 'ready.json') @{ticket=$ticket;utc=[datetime]::UtcNow.ToString('o');version=1}
            foreach ($file in @(Get-ChildItem -LiteralPath $dir -Filter '*.job.json' -File)) {
                if ($file.Name -notmatch '^([a-f0-9-]{36})\.job\.json$') { continue }
                $prefix=Join-Path $dir $Matches[1]
                $running=$prefix+'.running.json'
                [IO.File]::Move($file.FullName,$running)
                try {
                    $job=[IO.File]::ReadAllText($running,$utf8)|ConvertFrom-Json
                    if ($job.ticket -cne $ticket) { throw 'Recheck worker restarted. Refresh the inventory.' }
                    $result=Handle $job
                    $answer=@{ok=$true;result=$result;profile=$job.profile;action=$job.action;account=$job.account}
                } catch { $answer=@{ok=$false;error=($_.Exception.Message+' ('+($_.ScriptStackTrace -split "\n")[0].Trim()+')')} }
                Publish ($prefix+'.result.json') $answer
                [IO.File]::Delete($running)
            }
        } catch { [IO.File]::WriteAllText((Join-Path $env:LOCALAPPDATA 'SproutG-Octo\Recheck\last-error.txt'),$_.Exception.Message) }
        Start-Sleep -Seconds 1
    }
} finally { if ($owned) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
if ($reload) {
    $argsText='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "'+$PSCommandPath+'"'
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $argsText -WindowStyle Hidden
}
