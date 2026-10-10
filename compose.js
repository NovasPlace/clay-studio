/* Reading a home server: which apps a compose file says it runs, and where each one's web page is. It also reads the
   output of docker ps, and plain lines like "Jellyfin 192.168.1.20:8096". Text in, plain data out: no network, no
   Docker socket. Only service names, images, ports, network modes and a few labels are read. Environment values,
   secrets and everything else in the file are skipped, and nothing of the file itself is kept. */
(function(scope){
  'use strict';
  // ---- the part of YAML compose files use: block maps and lists, [..] and {..}, quotes, comments, | and > text,
  // anchors with <<: merges, and several documents in one file. Every value is text (or null); nothing is typed. ----
  function fail(why,n){const e=new Error(why+(n?' (line '+n+')':''));e.why=why;e.line=n||0;throw e;}
  // A comment starts at a # after a space, outside quotes. A quote only opens where a value can start.
  function strip(s){let q='',prev='';
    for(let i=0;i<s.length;i++){const c=s[i];
      if(q){if(c==='\\'&&q==='"')i++;else if(c===q){if(q==="'"&&s[i+1]==="'")i++;else{q='';prev=c;}}continue;}
      if(c==='#'&&(!i||s[i-1]===' '||s[i-1]==='\t'))return s.slice(0,i).trimEnd();
      if((c==='"'||c==="'")&&(!prev||':-[{,?'.includes(prev))){q=c;continue;}
      if(c!==' '&&c!=='\t')prev=c;}
    return s.trimEnd();}
  const ESC={n:'\n',t:'\t',r:'\r','0':'\0',' ':' ','/':'/','"':'"','\\':'\\',e:'\x1b',a:'\x07',b:'\b',f:'\f',v:'\v',N:'\x85',_:'\xa0'};
  function quoted(t,at){const q=t[at];let s='';
    for(let j=at+1;j<t.length;j++){const c=t[j];
      if(q==="'"){if(c==="'"){if(t[j+1]==="'"){s+="'";j++;continue;}return {value:s,end:j+1};}s+=c;continue;}
      if(c==='"')return {value:s,end:j+1};
      if(c==='\\'){const e=t[++j],h={x:2,u:4,U:8}[e];if(h){const cp=parseInt(t.substr(j+1,h),16);s+=cp>=0&&cp<=0x10ffff?String.fromCodePoint(cp):'\ufffd';j+=h;}else s+=e in ESC?ESC[e]:e;continue;}
      s+=c;}
    return null;}
  const isSeq=t=>t==='-'||t[0]==='-'&&(t[1]===' '||t[1]==='\t');
  function keyOf(t){
    if(t[0]==='"'||t[0]==="'"){const q=quoted(t,0);if(!q)return null;const m=/^[ \t]*:(?:[ \t]+|$)/.exec(t.slice(q.end));return m?{key:q.value,rest:t.slice(q.end+m[0].length).trim()}:null;}
    if(/^[[\]{},#&*!|>%@`?]/.test(t)||isSeq(t))return null;const m=/:(?:[ \t]|$)/.exec(t);if(!m||!m.index)return null;
    return {key:t.slice(0,m.index).trim(),rest:t.slice(m.index+1).trim()};}
  function yaml(text){const raw=String(text).replace(/^\uFEFF/,'').split(/\r\n|\r|\n/),docs=[];let toks=[];
    const end=()=>{if(toks.length)docs.push(parse(toks,raw));toks=[];};
    raw.forEach((s,k)=>{if(/^(---|\.\.\.)([ \t]|$)/.test(s)){end();return;}if(/^%/.test(s))return;
      const m=/^( *)([ \t]*)(.*)$/.exec(s),t=strip(m[3]);if(!t)return;toks.push({n:k+1,ind:m[1].length,tab:m[2].includes('\t'),t});});
    end();return docs;}
  function parse(toks,raw){let i=0;const anchors={};
    const tabbed=k=>{if(k.tab)fail('A tab indents this line; YAML needs spaces.',k.n);};
    const props=rest=>{let anchor=null,m;while((m=/^([&!][^ \t]*)(?:[ \t]+|$)/.exec(rest))){if(m[1][0]==='&')anchor=m[1].slice(1);rest=rest.slice(m[0].length);}return {anchor,rest};};
    function node(ind){const k=toks[i];if(!k||k.ind<ind)return null;tabbed(k);if(isSeq(k.t))return seq(k.ind);if(keyOf(k.t))return map(k.ind);i++;return value(k.t,k,k.ind-1);}
    // what follows a key or a dash: a value on the same line, or a block below it (a key's list may sit at its own indent)
    function value(rest,tok,ind,key){const p=props(rest);rest=p.rest;let v;
      if(!rest){const nx=toks[i];v=nx&&(nx.ind>ind||key&&nx.ind===ind&&isSeq(nx.t))?node(nx.ind):null;}
      else if(rest[0]==='|'||rest[0]==='>')v=text(rest,tok,ind);
      else if(rest[0]==='['||rest[0]==='{')v=flow(rest,tok);
      else if(rest[0]==='*'){const a=rest.slice(1).trim();if(!(a in anchors))fail('“*'+a+'” refers to nothing above it.',tok.n);v=anchors[a];}
      else v=plain(rest,tok,ind);
      if(p.anchor)anchors[p.anchor]=v;return v;}
    // a value can carry on over more-indented lines below it; quoted ones until their quote closes
    function plain(rest,tok,ind){
      if(rest[0]==='"'||rest[0]==="'"){let t=rest,q=quoted(t,0);while(!q&&i<toks.length&&toks[i].ind>ind){t+=' '+toks[i].t;i++;q=quoted(t,0);}
        if(!q)fail('A quote here is never closed.',tok.n);if(t.slice(q.end).trim())fail('Something follows the closing quote.',tok.n);return q.value;}
      let s=rest;while(i<toks.length&&toks[i].ind>ind){s+=' '+toks[i].t;i++;}
      return /^(~|null|Null|NULL)$/.test(s)?null:s;}
    function text(head,tok,ind){const fold=head[0]==='>',keep=head.includes('+'),chop=head.includes('-'),fixed=+((/[1-9]/.exec(head)||[0])[0]);
      const lines=[];let at=-1,j=tok.n;
      for(;j<raw.length;j++){const s=raw[j];if(!s.trim()){lines.push('');continue;}const d=s.length-s.trimStart().length;
        if(at<0){if(d<=ind)break;at=fixed?ind+fixed:d;}if(d<at)break;lines.push(s.slice(at));}
      while(i<toks.length&&toks[i].n<=j)i++;
      let n=lines.length;while(n&&!lines[n-1])n--;const body=lines.slice(0,n);if(!body.length)return '';
      const s=fold?body.reduce((a,l,k)=>!k?l:a+(!l||!body[k-1]||/^\s/.test(l)?'\n':' ')+l,''):body.join('\n');
      return s+(chop?'':keep?'\n'.repeat(lines.length-n+1):'\n');}
    function closed(s){let d=0,q='';for(let j=0;j<s.length;j++){const c=s[j];
      if(q){if(c==='\\'&&q==='"')j++;else if(c===q){if(q==="'"&&s[j+1]==="'")j++;else q='';}continue;}
      if(c==='"'||c==="'")q=c;else if(c==='['||c==='{')d++;else if(c===']'||c==='}')d--;}return d<=0;}
    // [a, "b", {c: d}] and {a: 1, b: [x]}, which can run over several lines until their brackets close
    function flow(rest,tok){let s=rest;while(!closed(s)&&i<toks.length){s+=' '+toks[i].t;i++;}
      let j=0;const ws=()=>{while(j<s.length&&(s[j]===' '||s[j]==='\t'))j++;},bad=m=>fail(m,tok.n);
      function one(){ws();const c=s[j];
        if(c==='['){j++;const a=[];for(;;){ws();if(s[j]===']'){j++;return a;}if(j>=s.length)bad('A list in [ ] is missing its ].');a.push(one());ws();if(s[j]===','){j++;continue;}if(s[j]===']'){j++;return a;}bad('A list in [ ] is missing a comma or its ].');}}
        if(c==='{'){j++;const o={};for(;;){ws();if(s[j]==='}'){j++;return o;}if(j>=s.length)bad('A map in { } is missing its }.');const k=one();ws();let v=null;if(s[j]===':'){j++;v=one();ws();}if(k!=null&&k!=='__proto__')o[k]=v;if(s[j]===','){j++;continue;}if(s[j]==='}'){j++;return o;}bad('A map in { } is missing a comma or its }.');}}
        if(c==='"'||c==="'"){const q=quoted(s,j);if(!q)bad('A quote here is never closed.');j=q.end;return q.value;}
        if(c==='*'){const m=/^\*([^\s,\]}]+)/.exec(s.slice(j));if(!m||!(m[1] in anchors))bad('An alias here refers to nothing above it.');j+=m[0].length;return anchors[m[1]];}
        const st=j;while(j<s.length&&!',]}'.includes(s[j])&&!(s[j]===':'&&/[\s,\]}]/.test(s[j+1]||' ')))j++;
        const v=s.slice(st,j).trim();return v===''||v==='~'||v==='null'?null:v;}
      const v=one();ws();if(j<s.length)bad('Something follows the closing bracket.');return v;}
    function map(ind){const o={},merges=[];
      while(i<toks.length){const k=toks[i];if(k.ind<ind)break;tabbed(k);if(k.ind>ind)fail('This line is indented further than the lines around it.',k.n);if(isSeq(k.t))break;
        const kv=keyOf(k.t);if(!kv)fail('Expected “name: value” here.',k.n);i++;const v=value(kv.rest,k,ind,true);
        if(kv.key==='<<'){(Array.isArray(v)?v:[v]).forEach(m=>{if(m&&typeof m==='object'&&!Array.isArray(m))merges.push(m);else fail('<< merges a map, like <<: *defaults.',k.n);});continue;}
        // as in Docker, a name given twice is a mistake, never a quiet replacement
        if(Object.prototype.hasOwnProperty.call(o,kv.key))fail('“'+kv.key+'” is given twice here.'+(kv.key==='services'&&!ind?' To read several compose files at once, put a line of three dashes (---) between them.':''),k.n);
        if(kv.key!=='__proto__')o[kv.key]=v;}
      merges.forEach(m=>Object.keys(m).forEach(key=>{if(!(key in o))o[key]=m[key];}));return o;}
    function seq(ind){const a=[];
      while(i<toks.length){const k=toks[i];if(k.ind!==ind||!isSeq(k.t))break;tabbed(k);const rest=k.t.slice(1).replace(/^[ \t]+/,'');
        if(!rest){i++;const nx=toks[i];a.push(nx&&nx.ind>ind?node(nx.ind):null);continue;}
        // "- name: value" starts a map, and "- - x" a list, whose further lines line up with what follows the dash
        if(isSeq(rest)||keyOf(rest)){toks[i]={...k,ind:ind+k.t.length-rest.length,t:rest};a.push(node(toks[i].ind));continue;}
        i++;a.push(value(rest,k,ind));}
      return a;}
    const out=node(toks[0].ind);if(i<toks.length)fail('This line doesn’t fit where it is. Check its indent.',toks[i].n);return out;}

  // ---- apps people run at home, by image ----
  // Each: its id, its own name, the end of its image's name (any of several), where its web page is (the port inside the
  // container, "s" for https; the first one published wins), a title and a few words for the family, a colour from the
  // links page, and a path. "-": it has no web page.
  const APPS=[
    ['jellyfin','Jellyfin','jellyfin','8096 8920s','Films and shows','Pick up where you left off, on any screen in the house.','sun'],
    ['plex','Plex','plex|pms-docker','32400','Films and shows','The family’s films and shows, on the TV or a phone.','sun','/web'],
    ['emby','Emby','embyserver|emby','8096 8920s','Films and shows','Films and shows from the server, on any screen.','sun'],
    ['jellyseerr','Jellyseerr','jellyseerr','5055','Ask for a film','Ask for a film or a show, and it turns up in the library.','sun'],
    ['overseerr','Overseerr','overseerr','5055','Ask for a film','Ask for a film or a show, and it turns up in the library.','sun'],
    ['tautulli','Tautulli','tautulli','8181','What’s been watched','What’s been played on Plex, and by whom.','sun'],
    ['navidrome','Navidrome','navidrome','4533','Music','Every album we own, playing on any phone.','lilac'],
    ['audiobookshelf','Audiobookshelf','audiobookshelf','80 13378','Books','Audiobooks and podcasts for the car and bedtime.','lilac'],
    ['kavita','Kavita','kavita','5000','Comics and books','Comics, manga and e-books, read in the browser.','lilac'],
    ['komga','Komga','komga','25600','Comics','Comics and manga, a page at a time.','lilac'],
    ['calibreweb','Calibre-Web','calibre-web|calibre-web-automated','8083','E-books','Borrow a book from the family library.','lilac'],
    ['sonarr','Sonarr','sonarr','8989','TV downloads','Finds new episodes of the shows we follow.','sky'],
    ['radarr','Radarr','radarr','7878','Film downloads','Fetches the films on the wish list.','sky'],
    ['lidarr','Lidarr','lidarr','8686','Music downloads','New albums from favourite artists.','sky'],
    ['readarr','Readarr','readarr','8787','Book downloads','New books by favourite authors.','sky'],
    ['prowlarr','Prowlarr','prowlarr','9696','Indexers','Where the downloaders look for things.','sky'],
    ['bazarr','Bazarr','bazarr','6767','Subtitles','Subtitles for every film and show.','sky'],
    ['qbittorrent','qBittorrent','qbittorrent|qbittorrent-nox','8080','Downloads','What’s downloading right now.','water'],
    ['transmission','Transmission','transmission|transmission-openvpn','9091','Downloads','What’s downloading right now.','water'],
    ['deluge','Deluge','deluge','8112','Downloads','What’s downloading right now.','water'],
    ['sabnzbd','SABnzbd','sabnzbd','8080','Downloads','What’s downloading right now.','water'],
    ['nzbget','NZBGet','nzbget','6789','Downloads','What’s downloading right now.','water'],
    ['romm','RomM','romm','8080','Games','Old favourite games, playable in the browser.','rose'],
    ['immich','Immich','immich-server','2283 3001','Photos','Every family picture, backed up from your phone.','leaf'],
    ['photoprism','PhotoPrism','photoprism','2342','Photos','Every family picture, searchable by place and face.','leaf'],
    ['piwigo','Piwigo','piwigo','80','Photo albums','Albums to share with the whole family.','leaf'],
    ['nextcloudaio','Nextcloud AIO','nextcloud/all-in-one','8080s','Nextcloud setup','Updates and backups for Nextcloud.','sky'],
    ['nextcloud','Nextcloud','nextcloud','80 443s','Files','Documents and shared folders, like a cloud drive at home.','sky'],
    ['seafile','Seafile','seafile-mc|seafile','80 443s','Files','Documents and shared folders, like a cloud drive at home.','sky'],
    ['syncthing','Syncthing','syncthing','8384','Syncing','Keeps folders the same on every computer.','sky'],
    ['filebrowser','File Browser','filebrowser|filebrowser-quantum','80 8080','Files','The server’s folders, from any browser.','sky'],
    ['paperless','Paperless','paperless-ngx|paperless','8000','Documents','Letters and paperwork, scanned and searchable.','sky'],
    ['stirlingpdf','Stirling PDF','stirling-pdf|s-pdf','8080','PDF tools','Merge, split and sign PDFs.','sky'],
    ['pairdrop','PairDrop','pairdrop|snapdrop','3000 80','Send a file','Send a file from a phone to a computer.','water'],
    ['kopia','Kopia','kopia','51515','Backups','Copies of everything, kept safe.','water'],
    ['duplicati','Duplicati','duplicati','8200','Backups','Copies of everything, kept safe.','water'],
    ['homeassistant','Home Assistant','home-assistant|homeassistant','8123','The house','Lights, heating and the doorbell.','rose'],
    ['nodered','Node-RED','node-red','1880','Automations','What the house does by itself.','rose'],
    ['esphome','ESPHome','esphome','6052','Smart devices','The sensors and switches around the house.','rose'],
    ['zigbee2mqtt','Zigbee2MQTT','zigbee2mqtt','8080','Zigbee','Lights and sensors on the Zigbee network.','rose'],
    ['frigate','Frigate','frigate','8971s 5000','Cameras','The cameras around the house.','rose'],
    ['scrypted','Scrypted','scrypted','10443s 11080','Cameras','The cameras around the house.','rose'],
    ['homebox','Homebox','homebox','7745','Our things','Where everything in the house is kept.','leaf'],
    ['grocy','Grocy','grocy','80','Groceries','What’s in the cupboard, and what to buy.','leaf'],
    ['mealie','Mealie','mealie','9000 80','Recipes','What’s for dinner, and how to make it.','sun'],
    ['tandoor','Tandoor','vabene1111/recipes|tandoor|tandoor-recipes','8080 80','Recipes','What’s for dinner, and how to make it.','sun'],
    ['actual','Actual','actual-server|actualbudget/actual','5006','Budget','Where the money goes each month.','leaf'],
    ['firefly','Firefly III','fireflyiii/core','8080','Money','Accounts and spending, in one place.','leaf'],
    ['vikunja','Vikunja','vikunja','3456','To-dos','Chores and shared lists.','leaf'],
    ['memos','Memos','memos','5230','Notes','Quick notes for the whole family.','leaf'],
    ['bookstack','BookStack','bookstack','80 6875','How-tos','How the house works, written down.','sky'],
    ['wikijs','Wiki.js','requarks/wiki|wikijs','3000','Wiki','Everything we’ve written down.','sky'],
    ['trilium','Trilium','trilium|triliumnext/notes|triliumnext/trilium','8080','Notes','Notes, linked and searchable.','sky'],
    ['joplin','Joplin','joplin/server','22300','Notes','Notes that sync to every device.','sky'],
    ['vaultwarden','Vaultwarden','vaultwarden/server|bitwardenrs/server|vaultwarden','80','Passwords','One safe place for the family’s logins.','water'],
    ['pihole','Pi-hole','pihole','80','Ad blocking','Fewer ads on every device at home.','water','/admin'],
    ['adguardhome','AdGuard Home','adguardhome','80 3000','Ad blocking','Fewer ads on every device at home.','water'],
    ['wgeasy','WireGuard','wg-easy','51821','VPN','Reach home from anywhere.','water'],
    ['unifi','UniFi','unifi-network-application|unifi-controller|unifi','8443s','Wi-Fi','The network and the Wi-Fi.','water'],
    ['npm','Nginx Proxy Manager','nginx-proxy-manager','81','Web addresses','Which name goes to which app.','water'],
    ['authentik','authentik','goauthentik/server|authentik/server','9000 9443s','Sign-in','One sign-in for every app.','water'],
    ['portainer','Portainer','portainer-ce|portainer-ee|portainer','9443s 9000','Containers','Start and stop what runs on the server.','sky'],
    ['dockge','Dockge','dockge','5001','Stacks','The server’s compose files, in the browser.','sky'],
    ['uptimekuma','Uptime Kuma','uptime-kuma','3001','Is it up?','Which apps are up, and since when.','leaf'],
    ['glances','Glances','glances','61208','Server health','How busy the server is right now.','leaf'],
    ['netdata','Netdata','netdata','19999','Server health','How busy the server is right now.','leaf'],
    ['grafana','Grafana','grafana|grafana-oss|grafana-enterprise','3000','Dashboards','Charts of everything the server measures.','leaf'],
    ['gitea','Gitea','gitea','3000','Code','Our own code, kept at home.','lilac'],
    ['forgejo','Forgejo','forgejo','3000','Code','Our own code, kept at home.','lilac'],
    ['codeserver','code-server','code-server','8443 8080','Code editor','An editor in the browser, on the server’s files.','lilac'],
    ['homepage','Homepage','gethomepage/homepage|homepage','3000','Dashboard','Every app at a glance.','sky'],
    ['homarr','Homarr','homarr','7575','Dashboard','Every app at a glance.','sky'],
    ['heimdall','Heimdall','heimdall','80 443s','Dashboard','Every app at a glance.','sky'],
    ['dashy','Dashy','dashy','8080 80','Dashboard','Every app at a glance.','sky'],
    ['openwebui','Open WebUI','open-webui','8080','Chat','Ask the AI that runs at home.','lilac'],
    ['searxng','SearXNG','searxng','8080','Search','Search the web without being followed.','water'],
    ['changedetection','changedetection.io','changedetection.io|changedetection','5000','Page watcher','Tells us when a web page changes.','water'],
    ['freshrss','FreshRSS','freshrss','80','News','The sites we follow, in one place.','water'],
    ['miniflux','Miniflux','miniflux','8080','News','The sites we follow, in one place.','water'],
    ['wallabag','wallabag','wallabag','80','Read later','Articles saved to read later.','water'],
    ['linkding','linkding','linkding','9090','Bookmarks','Links worth keeping.','water'],
    ['linkwarden','Linkwarden','linkwarden','3000','Bookmarks','Links worth keeping.','water'],
    ['excalidraw','Excalidraw','excalidraw','80','Whiteboard','Sketch ideas together.','sun'],
    ['ittools','IT Tools','it-tools','80','Handy tools','Small tools for everyday jobs.','sun'],
    ['ntfy','ntfy','ntfy','80','Notifications','Alerts from the house to your phone.','rose'],
    ['gotify','Gotify','gotify/server|gotify','80','Notifications','Alerts from the house to your phone.','rose'],
    ['kiwix','Kiwix','kiwix-serve','8080','Offline Wikipedia','Wikipedia, even when the internet is down.','lilac'],
    ['jackett','Jackett','jackett','9117','Indexers','Where the downloaders look for things.','sky'],
    ['element','Element','element-web','80','Chat','Messages for the family, kept at home.','lilac'],
    ['minecraft','Minecraft','minecraft-server|minecraft-bedrock-server','-','','',''],
  ].map(([id,name,images,ports,title,blurb,color,path])=>({id,name,images:suffix(images),title,blurb,color,path:path||'',
    ports:ports==='-'?[]:ports.split(' ').map(p=>({port:parseInt(p,10),https:/s$/.test(p)})),web:ports!=='-'}));
  // what runs behind the apps, with no page of its own for the family: left out, and named as left out
  const HELPERS=[
    ['database','postgres|postgis|pgvecto-rs|pgvector|timescaledb|immich-app/postgres|mariadb|mysql|percona-server|mongo|mongodb|couchdb|influxdb|clickhouse-server|cockroach'],
    ['cache','redis|valkey|keydb|memcached|dragonfly|redis-stack-server'],
    ['search index','elasticsearch|opensearch|meilisearch|typesense|solr'],
    ['messages','rabbitmq|eclipse-mosquitto|mosquitto|nats|kafka|emqx'],
    ['helper','immich-machine-learning|tika|gotenberg|flaresolverr|unpackerr|recyclarr|byparr'],
    ['network','traefik|caddy|caddy-docker-proxy|nginx-proxy|acme-companion|cloudflared|tailscale|gluetun|wireguard|ddclient|duckdns|docker-socket-proxy|socket-proxy|haproxy|swag'],
    ['upkeep','watchtower|diun|autoheal|ouroboros'],
    ['monitoring','prometheus|node-exporter|cadvisor|promtail|loki|alertmanager|telegraf|blackbox-exporter|alloy'],
    ['office','collabora/code|onlyoffice/documentserver|documentserver'],
  ].map(([what,images])=>({what,images:suffix(images)}));
  function suffix(list){return new RegExp('(^|/)('+list.split('|').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')$','i');}
  // a worker, a scheduler or a one-off setup step is a helper whatever image it runs; so is a database by its name
  const WORKER=/(^|[-_])(worker|workers|celery|beat|cron|scheduler|migrate|migrations|init|setup|jobs)([-_]?\d+)?$/i;
  const STORE=/(^|[-_])(db|database|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|valkey|cache|broker|queue|ml)([-_]?\d+)?$/i;
  const NOT_WEB=new Set([21,22,23,25,53,67,68,69,110,123,137,138,139,143,161,389,445,465,514,587,636,853,993,995,1194,1883,1900,3306,3478,5353,5432,5672,6379,6881,6882,6883,6884,6885,6886,6887,6888,6889,7359,8883,9100,11211,25565,27017,41641,51413,51820]);
  const WEBBY=new Set([80,443,3000,5000,8000,8080,8081,8088,8443,8888,9000,9090]),SECURE=new Set([443,8443,9443]);
  const norm=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]/g,'');
  // an image's name without its registry, tag or digest: lscr.io/linuxserver/jellyfin:latest → lscr.io/linuxserver/jellyfin
  function bare(image){let s=String(image||'').trim().toLowerCase().replace(/@sha256:[0-9a-f]+$/,'');const slash=s.lastIndexOf('/'),colon=s.lastIndexOf(':');if(colon>slash)s=s.slice(0,colon);return s.replace(/^(docker\.io\/)?(library\/)?/,'');}
  const byImage=image=>{const b=bare(image);return b?APPS.find(a=>a.images.test(b)):null;};
  const byName=name=>{const n=norm(name);return n?APPS.find(a=>a.id===n||norm(a.name)===n):null;};
  const helperOf=image=>{const b=bare(image),h=b&&HELPERS.find(h=>h.images.test(b));return h?h.what:null;};
  const pretty=s=>{s=String(s).replace(/[-_.]+/g,' ').trim();return s?s[0].toUpperCase()+s.slice(1):'';};

  // ${VAR}, ${VAR:-default}, ${VAR-default}, ${VAR:+alt}, ${VAR:?error}, $VAR and $$, from .env and what the caller gives.
  // A default can hold another ${...}, so braces are matched rather than cut at the first }. What can't be filled in
  // stays as written, and its name goes in need.
  function sub(v,env,need){if(v==null)return '';const s=String(v);let out='';
    const fill=(expr,raw)=>{const e=/^([A-Za-z_][A-Za-z0-9_]*)(?:(:?)([-?+])([\s\S]*))?$/.exec(expr);if(!e)return raw;
      const [,name,colon,op,word]=e,has=Object.prototype.hasOwnProperty.call(env,name),val=has?env[name]:'',set=has&&(!colon||val!=='');
      if(op==='-')return set?val:sub(word,env,need);if(op==='+')return set?sub(word,env,need):'';if(set)return val;if(need)need.add(name);return raw;};
    for(let i=0;i<s.length;i++){const c=s[i];if(c!=='$'){out+=c;continue;}
      if(s[i+1]==='$'){out+='$';i++;continue;}
      if(s[i+1]==='{'){let d=1,j=i+2;for(;j<s.length&&d;j++){if(s[j]==='{')d++;else if(s[j]==='}')d--;}if(d){out+=s.slice(i);break;}out+=fill(s.slice(i+2,j-1),s.slice(i,j));i=j-1;continue;}
      const m=/^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i+1));if(m){out+=fill(m[0],'$'+m[0]);i+=m[0].length;continue;}
      out+=c;}
    return out;}
  const unset=v=>[...String(v).matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map(m=>m[1]);
  function dotenv(text){const env={};String(text).split(/\r\n|\r|\n/).forEach(l=>{const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);if(!m)return;let v=m[2].trim();
    if(v[0]==='"'){const q=quoted(v,0);v=q?q.value:v.slice(1);}else if(v[0]==="'"){const e=v.indexOf("'",1);v=e>0?v.slice(1,e):v.slice(1);}else v=v.replace(/\s+#.*$/,'');env[m[1]]=v;});return env;}
  const isEnv=f=>/(^|[\\/])\.env(\.[\w-]+)?$|\.env$/i.test(f.name||'');

  // ---- ports: "8096:8096", "127.0.0.1:8096:8096/tcp", "[::]:80:80", "8000-8010:8000-8010", or target/published ----
  function range(v){const m=/^\s*(\d{1,5})(?:\s*-\s*(\d{1,5}))?\s*$/.exec(String(v==null?'':v));return m?{from:+m[1],to:m[2]?+m[2]:+m[1]}:null;}
  function ports(list,sb){const out=[];(Array.isArray(list)?list:list==null?[]:[list]).forEach(p=>{
    if(p&&typeof p==='object'&&!Array.isArray(p)){const c=range(sb(p.target)),pub=sb(p.published),ip=sb(p.host_ip).replace(/^\[|\]$/g,''),wait=/\$\{?[A-Za-z_]/.test(pub+ip);if(!c)return;
      out.push({ip:wait?'':ip,host:pub&&!wait?range(pub):null,container:c,proto:String(sb(p.protocol)||'tcp').toLowerCase(),wait});return;}
    let s=sb(p).trim(),proto='tcp',ip='';if(!s)return;const wait=/\$\{?[A-Za-z_]/.test(s),sl=s.lastIndexOf('/');if(sl>0){proto=s.slice(sl+1).toLowerCase();s=s.slice(0,sl);}
    if(s[0]==='['){const e=s.indexOf(']');if(e<0)return;ip=s.slice(1,e);s=s.slice(e+2);}
    const parts=s.split(':'),c=range(parts.pop());if(!c)return;let host=null;
    if(parts.length){const h=parts.pop();host=h&&!wait?range(h):null;if(parts.length&&!ip)ip=parts.join(':');}
    out.push({ip:wait?'':ip,host,container:c,proto,wait});});
  return out;}
  // the port on the server for a port inside the container; none when Docker picks one each time it starts
  function outside(p,port){if(!p.host)return null;const w=p.container.to-p.container.from;return p.host.to-p.host.from===w?p.host.from+port-p.container.from:null;}
  const loop=ip=>/^(127\.|localhost$|::1$)/i.test(ip||'');
  // which published port is the app's web page: the one its catalog entry names, or a guess at the first likely one
  function web(maps,entry,inOrder){const tcp=maps.filter(p=>p.proto==='tcp'),has=(p,n)=>p.container.from<=n&&n<=p.container.to;
    if(entry)for(const w of entry.ports){const p=tcp.find(p=>has(p,w.port));if(p)return {p,port:outside(p,w.port),https:w.https,path:entry.path,guess:false};}
    const c=tcp.filter(p=>!NOT_WEB.has(p.container.from)),p=!inOrder&&c.find(p=>WEBBY.has(p.container.from))||c[0];
    return p?{p,port:outside(p,p.container.from),https:SECURE.has(p.container.from),path:entry?entry.path:'',guess:true}:null;}

  // ---- labels that already say where an app is: Traefik and Caddy routers, Homepage and Unraid ----
  function labelsOf(v,sb){const o={};if(Array.isArray(v))v.forEach(s=>{s=String(s==null?'':s);const e=s.indexOf('=');if(e>0)o[s.slice(0,e).trim()]=sb(s.slice(e+1));});
    else if(v&&typeof v==='object')Object.keys(v).forEach(k=>{o[k]=sb(v[k]);});return o;}
  // local names and addresses are plain http; anything else is assumed to have a certificate
  const scheme=h=>/^\[|^\d{1,3}(\.\d{1,3}){3}$/.test(h)||!h.includes('.')||/\.(lan|local|home|internal|localhost|home\.arpa|fritz\.box|localdomain)$/i.test(h)?'http':'https';
  function traefik(l){if(/^false$/i.test(l['traefik.enable']||''))return null;const rs={};
    Object.keys(l).forEach(k=>{const m=/^traefik\.http\.routers\.([^.]+)\.(rule|tls|entrypoints|tls\.certresolver)$/i.exec(k);if(m)(rs[m[1]]=rs[m[1]]||{})[m[2].toLowerCase()]=l[k];});
    const all=Object.values(rs).map(r=>{const h=/\bHost\(\s*[`"']([^`"']+)[`"']/.exec(r.rule||'');if(!h||/[*{}]/.test(h[1]))return null;const p=/\bPathPrefix\(\s*[`"']([^`"']+)[`"']/.exec(r.rule||'');
      const tls=/^true$/i.test(r.tls||'')||!!r['tls.certresolver']||/websecure|https|443/i.test(r.entrypoints||''),http=/^\s*(web|http|80)\s*$/i.test(r.entrypoints||'');
      return {tls,href:(tls?'https':http?'http':scheme(h[1]))+'://'+h[1]+(p&&p[1]!=='/'?p[1].replace(/\/$/,''):'')};}).filter(Boolean);
    const v1=/\bHost:\s*([^,;\s]+)/i.exec(l['traefik.frontend.rule']||'');if(!all.length&&v1)return scheme(v1[1])+'://'+v1[1];
    return all.length?(all.find(r=>r.tls)||all[0]).href:null;}
  function caddy(l){const k=Object.keys(l).find(k=>/^caddy(_\d+)?$/.test(k));if(!k)return null;const a=String(l[k]).trim().split(/[\s,]+/)[0];
    const m=/^(https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(:\d{1,5})?(\/[^\s*]*)?\*?$/i.exec(a||'');if(!m)return null;
    return (m[1]?m[1].toLowerCase():'https://')+m[2]+(m[3]||'')+(m[4]&&m[4]!=='/'?m[4].replace(/\/$/,''):'');}
  function unraid(v,maps){const m=/^(https?):\/\/\[IP\](?::\[PORT:(\d+)\])?(\/\S*)?$/i.exec(String(v||'').trim());if(!m)return null;
    const c=m[2]?+m[2]:80,p=maps.find(p=>p.proto==='tcp'&&p.container.from<=c&&c<=p.container.to),port=p&&outside(p,c)||c;
    return {port,https:/^https$/i.test(m[1]),path:m[3]&&m[3]!=='/'?m[3]:'',ip:''};}

  // ---- one service: an app with a page (and where it is), a helper, or left out with the reason ----
  // Labels that give an app its address count only once their ${...} are filled in. A widget's key, or any other
  // label, is nothing the page needs.
  const ADDRESSING=/^(traefik\.http\.routers\.[^.]+\.rule|traefik\.frontend\.rule|caddy(_\d+)?|homepage\.href|net\.unraid\.docker\.webui)$/i;
  function one(name,s,o,out){const {sb,need}=o,image=sb(s.image),cname=sb(s.container_name),l=labelsOf(s.labels,v=>sb(v)),mode=sb(s.network_mode,need);
    Object.keys(l).forEach(k=>{if(ADDRESSING.test(k)&&/\$\{?[A-Za-z_]|\{\{/.test(l[k])){unset(l[k]).forEach(n=>need.add(n));delete l[k];}});
    let entry=byImage(image);const what=!entry&&helperOf(image),helper=w=>{if(!out.helpers.some(h=>h.service===name))out.helpers.push({service:name,what:w});};
    if(WORKER.test(name))return helper('helper');
    if(what)return helper(what);
    entry=entry||byName(name)||byName(cname)||byName(l['homepage.name']);
    if(!entry&&STORE.test(name))return helper('helper');
    // Who it is, the same from one drop to the next: its service name, with what it runs when that name is a general
    // one like "app" or "server" that other compose files use too.
    const tag=entry?entry.id:norm(bare(image).split('/').pop());let key=tag&&!norm(name).includes(tag)?tag+'-'+name:name;
    if(entry&&!entry.web)return out.skipped.push({service:name,why:'has no web page'});
    const maps=o.maps||ports(s.ports,v=>sb(v,need)),via=/^(?:service|container):(.+)$/.exec(mode);
    // An app on another container's network (a VPN, say) is reached through that container's ports: its own, then not
    // the ones gluetun keeps for itself, nor ones the other apps sharing it are known to use.
    let own=maps;
    if(via){const vpn=o.others(via[1])||{},mine=entry?entry.ports.map(p=>p.port):[],keeps=/(^|\/)gluetun$/.test(bare(sb(vpn.image)))?[8888,8388,8000]:[],theirs=o.sharing(via[1],name);
      own=ports(vpn.ports,v=>sb(v,need)).filter(p=>mine.includes(p.container.from)||!keeps.includes(p.container.from)&&!theirs.includes(p.container.from));}
    let link=null,note='',guess=false;const home=l['homepage.href'],tr=traefik(l),cd=caddy(l),ur=unraid(l['net.unraid.docker.webui'],maps);
    if(home&&/^https?:\/\/[^\s/]+/i.test(home))link={href:home};else if(tr)link={href:tr};else if(cd)link={href:cd};else if(ur)link=ur;
    else{const w=web(own,entry,!!via),wants=()=>need.size?'needs '+[...need].join(', ')+' from .env':'';
      if(w&&w.port&&!loop(w.p.ip))link={port:w.port,https:w.https,path:w.path,ip:/^(0\.0\.0\.0|::|\*)?$/.test(w.p.ip)?'':w.p.ip},guess=w.guess;
      else if(w&&w.p.wait)note=wants()||'has a port that isn’t written out';
      else if(w&&loop(w.p.ip))note='only listens on the server itself';
      else if(w)note='gets a different port each time it starts';
      else if(mode==='host'&&entry)link={port:entry.ports[0].port,https:entry.ports[0].https,path:entry.path,ip:''};
      else note=wants()||(entry?'has no port in the file':'has no web page');}
    if(/from \.env$/.test(note))need.forEach(v=>out.missing.add(v));
    if(!link&&!entry)return out.skipped.push({service:name,why:note});
    // An app Clay doesn't know is told apart by where it is, too: two "web: build: ." sites are two apps. A known app
    // met twice is the same app (the one with an address wins), unless both say where it is and they differ.
    const where=link?link.href?link.href.replace(/^https?:\/\//i,'').replace(/[/?#].*$/,''):String(link.port):'';
    if(!entry&&where)key+='-'+where;
    const twin=out.apps.find(a=>a.key===key);
    if(twin){if(!link||!twin.link||JSON.stringify(twin.link)===JSON.stringify(link)){if(!twin.link&&link)Object.assign(twin,{link,note:'',guess});return;}key+='-'+where;}
    out.apps.push({service:name,key,id:entry?entry.id:'',name:l['homepage.name']||(entry?entry.name:pretty(name)),title:entry?entry.title:pretty(l['homepage.name']||name),
      blurb:l['homepage.description']||(entry?entry.blurb:''),color:entry?entry.color:'',link,note:link?'':note,guess,group:l['homepage.group']||o.project||'',
      names:[...new Set([norm(name),norm(cname),entry&&entry.id,entry&&norm(entry.name),norm(l['homepage.name'])].filter(Boolean))]});}
  function services(doc,env,out,project){const all=doc.services||doc,mode=n=>sub((all[n]&&all[n].network_mode)||'',env);
    Object.keys(all).forEach(name=>{const s=all[name];if(!s||typeof s!=='object'||Array.isArray(s))return out.skipped.push({service:name,why:'isn’t written as a service'});
      const need=new Set(),sb=(v,n)=>typeof v==='string'||typeof v==='number'?sub(v,env,n):'';
      one(name,s,{sb,need,project,others:n=>all[n]||Object.values(all).find(o=>o&&o.container_name===n),
        sharing:(via,me)=>Object.keys(all).filter(n=>n!==me&&/^(service|container):/.test(mode(n))&&mode(n).replace(/^(service|container):/,'')===via)
          .map(n=>{const e=byImage(sub((all[n]||{}).image,env))||byName(n);return e&&e.ports.length?e.ports[0].port:0;}).filter(Boolean)},out);});}
  // A compose file that doesn't read as YAML is read a service at a time, so one broken service doesn't hide the rest.
  function salvage(text,env,out,file){const raw=String(text).replace(/^\uFEFF/,'').split(/\r\n|\r|\n/),ats=raw.map((s,k)=>/^services:\s*(#.*)?$/.test(s)?k:-1).filter(k=>k>=0);if(!ats.length)return false;
    const nm=/^name:\s*["']?([^"'#\s]+)/m.exec(text);
    ats.forEach(at=>{const starts=[];let ind=-1,end=raw.length;
      for(let k=at+1;k<raw.length;k++){const s=raw[k];if(!s.trim()||/^\s*#/.test(s))continue;const d=s.length-s.trimStart().length;if(!d){end=k;break;}if(ind<0)ind=d;if(d===ind)starts.push(k);}
      const doc={};starts.forEach((st,x)=>{const en=x+1<starts.length?starts[x+1]:end,name=(keyOf(strip(raw[st].trim()))||{key:raw[st].trim()}).key;
        try{const d=yaml(raw.slice(st,en).map(s=>s.slice(Math.min(ind,s.length-s.trimStart().length))).join('\n'))[0];if(d&&typeof d==='object')Object.assign(doc,d);}
        catch(e){out.skipped.push({service:name,why:'couldn’t be read: '+(e.why||e.message).replace(/\.$/,'')+(e.line?' (line '+(e.line+st)+' of '+file+')':'')});}});
      services({services:doc},env,out,nm?nm[1]:'');});
    return true;}

  // ---- docker ps and docker compose ps: the columns line up under their headings ----
  function ps(text,env,out){const ls=String(text).split(/\r\n|\r|\n/),h=ls.findIndex(l=>/^\s*(CONTAINER ID|NAMES?)\s{2,}/.test(l)&&/\sIMAGE\s/.test(l)&&/\sPORTS(\s|$)/.test(l));if(h<0)return false;
    const cols=[...ls[h].matchAll(/\S+(?: \S+)*/g)].map(m=>({name:m[0],at:m.index})),col=(l,n)=>{const k=cols.findIndex(c=>c.name===n);return k<0?'':l.slice(cols[k].at,k+1<cols.length?cols[k+1].at:undefined).trim();};
    // docker ps names containers project-service-1; without that number a worker reads as a worker
    ls.slice(h+1).forEach(l=>{if(!l.trim())return;const name=col(l,'SERVICE')||(col(l,'NAMES')||col(l,'NAME')).replace(/[-_]\d+$/,'');if(!name)return;
      const maps=[];col(l,'PORTS').split(/,\s*/).forEach(p=>{const m=/^(?:(.*):(\d+(?:-\d+)?)->)?(\d+(?:-\d+)?)\/(\w+)$/.exec(p.trim());if(!m)return;
        const ip=(m[1]||'').replace(/^\[|\]$/g,''),c=range(m[3]),host=m[2]?range(m[2]):null;if(!maps.some(o=>o.container.from===c.from&&o.proto===m[4]&&o.host&&host&&o.host.from===host.from))maps.push({ip:ip===':'?'::':ip,host,container:c,proto:m[4]});});
      one(name,{image:col(l,'IMAGE')},{sb:v=>v==null?'':String(v),need:new Set(),maps,others:()=>null,sharing:()=>[]},out);});
    return true;}
  // ---- one app a line: "Jellyfin 192.168.1.20:8096", "Photos - https://photos.example.com", or just an address ----
  const ADDRESS=/^(https?:\/\/\S+|(?:\[[0-9a-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?=:\d))(?::\d{1,5})?(?:\/\S*)?)$/i;
  function lines(text,out){const rows=[];
    for(let l of String(text).split(/\r\n|\r|\n/)){l=l.trim();if(!l||l[0]==='#')continue;const words=l.split(/\s+/),at=words[words.length-1];if(!ADDRESS.test(at)||/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)([?#]|$)/i.test(at))return false;
      const name=words.slice(0,-1).join(' ').replace(/[\s:=|,–—-]+$/,'').trim(),h=/^(?:https?:\/\/)?(\[[^\]]+\]|[^/:\s]+)/i.exec(at),host=h?h[1]:at;
      rows.push({name:name||(/^[\[\d]/.test(host)?at.replace(/^https?:\/\//i,''):host.split('.')[0]),at});}
    if(!rows.length)return false;
    rows.forEach(({name,at})=>{const entry=byName(name),m=/^(?:(https?):\/\/)?(\[[^\]]+\]|[^/:\s]+)(?::(\d+))?(\/\S*)?$/i.exec(at);if(!m)return;
      // a known app on its usual port speaks what that port speaks: Portainer on 9443 is https, Jellyfin on 8096 isn't
      // (a public name typed without a port is a reverse proxy's, which says nothing of the port inside the container)
      const known=!m[1]&&entry&&(m[3]?entry.ports.find(p=>p.port===+m[3]):scheme(m[2])==='http'&&entry.ports.find(p=>p.port===80));let href=m[1]?at:(known?known.https?'https':'http':scheme(m[2]))+'://'+at;
      if(entry&&entry.path&&!m[4])href+=entry.path;
      const key=norm(name)||name;if(out.apps.some(a=>a.key===key))return;
      out.apps.push({service:name,key,id:entry?entry.id:'',name:entry?entry.name:name,title:entry?entry.title:name,blurb:entry?entry.blurb:'',color:entry?entry.color:'',link:{href},note:'',guess:false,group:'',
        names:[...new Set([norm(name),entry&&entry.id,entry&&norm(entry.name)].filter(Boolean))]});});
    return true;}

  function split(text){const parts=[[]],seen=new Set();
    String(text).split(/\r\n|\r|\n/).forEach(l=>{const k=!/^[\s#-]/.test(l)&&keyOf(strip(l));if(k){if(seen.has(k.key)){parts.push([]);seen.clear();}seen.add(k.key);}parts[parts.length-1].push(l);});
    return parts.map(ls=>ls.join('\n'));}
  // Files in, apps out: [{name, text}], or text. A .env among them fills in the ${...} its compose file uses.
  function read(files,o={}){const env=Object.assign({},o.env||{}),out={apps:[],helpers:[],skipped:[],problems:[],missing:new Set()};
    const list=(Array.isArray(files)?files:[files]).map(f=>typeof f==='string'?{name:'',text:f}:f).filter(f=>f&&typeof f.text==='string');
    list.filter(isEnv).forEach(f=>Object.assign(env,dotenv(f.text)));
    const file=f=>{const label=f.name||'That';let docs=null,err=null;
      try{docs=yaml(f.text);}catch(e){err=e;}
      // Two compose files run together: each starts again where a top-level name comes round a second time, and is read
      // whole, so the anchors it defines stay with it.
      if(err&&/given twice/.test(err.why||'')){const parts=split(f.text);if(parts.length>1){parts.forEach(text=>file({name:f.name,text}));return;}}
      const objs=(docs||[]).filter(d=>d&&typeof d==='object'&&!Array.isArray(d));
      const composes=objs.filter(d=>d.services&&typeof d.services==='object'&&!Array.isArray(d.services));
      if(composes.length){composes.forEach(d=>services(d,env,out,typeof d.name==='string'?d.name:''));return;}
      // a few services copied out of a compose file, without the "services:" above them
      const loose=objs.filter(d=>Object.values(d).some(s=>s&&typeof s==='object'&&!Array.isArray(s)&&('image' in s||'ports' in s||'build' in s)));
      if(loose.length){loose.forEach(d=>services({services:d},env,out,''));return;}
      const had=out.apps.length;if(err&&salvage(f.text,env,out,f.name||'the file')){if(out.apps.length===had)out.problems.push(label+' couldn’t be read as a compose file: '+err.message);return;}
      if(ps(f.text,env,out)||lines(f.text,out))return;
      out.problems.push(label+(err&&/^\s*\w[\w.-]*:/m.test(f.text)?' couldn’t be read as a compose file: '+err.message:' doesn’t look like a compose file, docker ps, or one app a line.'));};
    list.filter(f=>!isEnv(f)).forEach(file);
    out.missing=[...out.missing];return out;}
  const app=name=>byName(name)||null;
  const api={yaml,read,ports,sub,dotenv,bare,app,norm,APPS,HELPERS};
  if(typeof module==='object'&&module.exports)module.exports=api;else scope.ClayCompose=api;
})(typeof globalThis!=='undefined'?globalThis:this);
