const assert=require('node:assert/strict');
const C=require('../compose.js');
let passed=0;
function test(name,fn){fn();console.log('PASS '+name);passed++;}
const app=(r,service)=>r.apps.find(a=>a.service===service);
const port=(r,service)=>{const a=app(r,service);return a&&a.link&&(a.link.href||a.link.port);};

test('YAML: maps, lists, quotes, comments, flow, anchors and merges',()=>{
  const [d]=C.yaml([
    'x-base: &base',
    '  restart: unless-stopped   # a comment',
    '  tz: "Europe/London" # another',
    'x-more: &more {restart: always, user: "1000:1000"}',
    'services:',
    '  "web":',
    '    <<: [*base, *more]',
    '    image: nginx:1.27',
    '    command: "echo \'#not a comment\'"',
    '    ports:',
    '    - "8081:80"',
    '    - 8443:443/tcp',
    '    tags: [a, "b, c", {d: e}]',
    '    note: \'it\'\'s quoted\'',
    '    empty:',
    '    nothing: ~',
  ].join('\n'));
  const w=d.services.web;
  assert.equal(w.restart,'unless-stopped');assert.equal(w.tz,'Europe/London');assert.equal(w.user,'1000:1000');
  assert.equal(w.command,"echo '#not a comment'");assert.deepEqual(w.ports,['8081:80','8443:443/tcp']);
  assert.deepEqual(w.tags,['a','b, c',{d:'e'}]);assert.equal(w.note,"it's quoted");assert.equal(w.empty,null);assert.equal(w.nothing,null);
});
test('YAML: | and > text, several documents, flow over several lines, maps in lists',()=>{
  const docs=C.yaml(['a: |','  one','  # still text','','  two','b: >-','  folded','  line','c: [','  x,','  y',']','---','- name: first','  port: 1','- - nested','---','plain words'].join('\n'));
  assert.equal(docs.length,3);assert.equal(docs[0].a,'one\n# still text\n\ntwo\n');assert.equal(docs[0].b,'folded line');assert.deepEqual(docs[0].c,['x','y']);
  assert.deepEqual(docs[1],[{name:'first',port:'1'},['nested']]);assert.equal(docs[2],'plain words');
});
test('YAML: mistakes are named with their line',()=>{
  assert.throws(()=>C.yaml('a:\n    b: 1\n  c: 2'),/indented further|doesn’t fit/);
  assert.throws(()=>C.yaml('a:\n\tb: 1'),/tab.*\(line 2\)/);
  assert.throws(()=>C.yaml('a: "open\nb: 1'),/never closed\. \(line 1\)/);
  assert.throws(()=>C.yaml('a: *nowhere'),/refers to nothing/);
});

const IMMICH=[
  '#','# WARNING: To install Immich, follow the guide','#','name: immich','','services:','  immich-server:','    container_name: immich_server',
  '    image: ghcr.io/immich-app/immich-server:${IMMICH_VERSION:-release}','    volumes:','      # Do not edit the next line.','      - ${UPLOAD_LOCATION}:/usr/src/app/upload',
  '      - /etc/localtime:/etc/localtime:ro','    env_file:','      - .env','    ports:',"      - '2283:2283'",'    depends_on:','      - redis','      - database','    restart: always',
  '    healthcheck:','      disable: false','','  immich-machine-learning:','    container_name: immich_machine_learning',
  '    image: ghcr.io/immich-app/immich-machine-learning:${IMMICH_VERSION:-release}','    volumes:','      - model-cache:/cache','    restart: always','',
  '  redis:','    container_name: immich_redis','    image: docker.io/valkey/valkey:8-bookworm@sha256:ff21bc0f8194dc9c105b769aeabf9585fea6a8ed649c0781caeac5cb3c247884',
  '    healthcheck:','      test: redis-cli ping || exit 1','    restart: always','','  database:','    container_name: immich_postgres',
  '    image: ghcr.io/immich-app/postgres:14-vectorchord0.3.0-pgvectors0.2.0','    environment:','      POSTGRES_PASSWORD: ${DB_PASSWORD}','      POSTGRES_USER: ${DB_USERNAME}',
  "      POSTGRES_INITDB_ARGS: '--data-checksums'",'    volumes:','      - ${DB_DATA_LOCATION}:/var/lib/postgresql/data','    shm_size: 128mb','    restart: always','','volumes:','  model-cache:'].join('\n');
test('an Immich compose file: one app, three helpers left out',()=>{
  const r=C.read([{name:'compose.yaml',text:IMMICH},{name:'.env',text:'UPLOAD_LOCATION=./library\nDB_PASSWORD=hunter2\n'}]);
  assert.deepEqual(r.apps.map(a=>a.service),['immich-server']);const a=app(r,'immich-server');
  assert.equal(a.name,'Immich');assert.equal(a.title,'Photos');assert.deepEqual(a.link,{port:2283,https:false,path:'',ip:''});assert.equal(a.group,'immich');
  assert.deepEqual(r.helpers.map(h=>h.service).sort(),['database','immich-machine-learning','redis']);assert.deepEqual(r.missing,[]);
  assert.ok(!JSON.stringify(r).includes('hunter2'),'nothing from the environment is kept');
});

const MEDIA=[
  'x-common: &common','  restart: unless-stopped','  environment:','    - PUID=1000','    - TZ=Europe/London','services:',
  '  jellyfin:','    <<: *common','    image: lscr.io/linuxserver/jellyfin:latest','    container_name: jellyfin','    ports:','      - 8096:8096','      - 8920:8920 #optional','      - 7359:7359/udp','      - 1900:1900/udp',
  '  sonarr:','    <<: *common','    image: lscr.io/linuxserver/sonarr:latest','    ports: ["8989:8989"]',
  '  radarr:','    image: lscr.io/linuxserver/radarr','    ports:','      - target: 7878','        published: "7878"','        protocol: tcp',
  '  qbittorrent:','    image: lscr.io/linuxserver/qbittorrent:latest','    network_mode: "service:gluetun"',
  '  gluetun:','    image: qmcgaw/gluetun','    cap_add: [NET_ADMIN]','    ports:','      - 8080:8080   # qbittorrent','      - 6881:6881','      - 6881:6881/udp',
  '  homeassistant:','    image: ghcr.io/home-assistant/home-assistant:stable','    network_mode: host',"    volumes: ['/opt/ha:/config']",
  '  audiobookshelf:','    image: ghcr.io/advplyr/audiobookshelf','    ports:','      - "13378:80"',
  '  glances:','    image: nicolargo/glances','    ports:','      - 127.0.0.1:61208:61208',
  '  whoami:','    image: traefik/whoami','    ports:','      - "${WHOAMI_PORT:-8000}:80"',
  '  mystery:','    image: example/mystery','    ports:','      - "9999"',
  '  samba:','    image: dperson/samba','    ports:','      - 139:139','      - 445:445',
  '  watchtower:','    image: containrrr/watchtower','  db:','    image: example/custom-db','  minecraft:','    image: itzg/minecraft-server','    ports: ["25565:25565"]'].join('\n');
test('a media stack: ports long and short, a VPN neighbour, the host network, guesses and what is left out',()=>{
  const r=C.read({name:'docker-compose.yml',text:MEDIA});
  assert.deepEqual(r.apps.map(a=>a.service),['jellyfin','sonarr','radarr','qbittorrent','homeassistant','audiobookshelf','glances','whoami']);
  assert.equal(port(r,'jellyfin'),8096);assert.equal(port(r,'sonarr'),8989);assert.equal(port(r,'radarr'),7878);
  assert.equal(port(r,'qbittorrent'),8080,'reached through gluetun');assert.equal(port(r,'homeassistant'),8123,'the host network: its usual port');
  assert.equal(port(r,'audiobookshelf'),13378,'the port outside, for the page inside');
  assert.equal(app(r,'glances').link,null);assert.match(app(r,'glances').note,/only listens on the server itself/);
  assert.equal(port(r,'whoami'),8000);assert.equal(app(r,'whoami').guess,true);assert.equal(app(r,'whoami').name,'Whoami');
  assert.deepEqual(r.helpers.map(h=>h.service+':'+h.what),['gluetun:network','watchtower:upkeep','db:helper']);
  const left=Object.fromEntries(r.skipped.map(s=>[s.service,s.why]));
  assert.match(left.mystery,/different port each time/);assert.match(left.samba,/no web page/);assert.match(left.minecraft,/no web page/);
});

const LABELS=[
  'services:','  jellyfin:','    image: jellyfin/jellyfin','    labels:','      - "traefik.enable=true"','      - "traefik.http.routers.jf-http.rule=Host(`jellyfin.example.com`)"','      - "traefik.http.routers.jf-http.entrypoints=web"',
  '      - "traefik.http.routers.jellyfin.rule=Host(`jellyfin.example.com`)"','      - "traefik.http.routers.jellyfin.entrypoints=websecure"','      - "traefik.http.routers.jellyfin.tls.certresolver=le"',
  '  paperless:','    image: ghcr.io/paperless-ngx/paperless-ngx','    labels:','      traefik.http.routers.docs.rule: Host(`docs.home.lan`) && PathPrefix(`/paper/`)','      traefik.http.routers.docs.entrypoints: web',
  '  vaultwarden:','    image: vaultwarden/server:latest','    labels:','      caddy: vault.example.org','      caddy.reverse_proxy: "{{upstreams 80}}"',
  '  mealie:','    image: ghcr.io/mealie-recipes/mealie:v2.0.0','    labels:','      homepage.group: Kitchen','      homepage.name: Mealie','      homepage.href: http://mealie.home.lan','      homepage.description: Recipes for the week','      homepage.widget.key: SECRET-api-key-123',
  '  plex:','    image: plexinc/pms-docker','    labels:','      net.unraid.docker.webui: "http://[IP]:[PORT:32400]/web"','    ports:','      - 32401:32400',
  '  off:','    image: grafana/grafana','    labels: ["traefik.enable=false","traefik.http.routers.g.rule=Host(`g.example.com`)"]','    ports: ["3000:3000"]',
  '  traefik:','    image: traefik:v3.1','    ports: ["80:80", "443:443", "8080:8080"]'].join('\n');
test('labels that say where an app is: Traefik, Caddy, Homepage and Unraid',()=>{
  const r=C.read({name:'compose.yaml',text:LABELS});
  assert.equal(port(r,'jellyfin'),'https://jellyfin.example.com','the router with a certificate wins');
  assert.equal(port(r,'paperless'),'http://docs.home.lan/paper');assert.equal(port(r,'vaultwarden'),'https://vault.example.org');
  const m=app(r,'mealie');assert.equal(m.link.href,'http://mealie.home.lan');assert.equal(m.blurb,'Recipes for the week');assert.equal(m.group,'Kitchen');assert.equal(m.title,'Recipes');
  assert.deepEqual(app(r,'plex').link,{port:32401,https:false,path:'/web',ip:''});assert.equal(port(r,'off'),3000,'traefik.enable=false: its router is ignored');
  assert.deepEqual(r.helpers.map(h=>h.service),['traefik']);assert.ok(!JSON.stringify(r).includes('SECRET'),'widget keys are never read');
});
test('settings from .env, addresses on the server, IPv6, ranges and loopback',()=>{
  const text=['services:','  jellyfin:','    image: jellyfin/jellyfin','    ports:','      - "${JF_PORT}:8096"','  sonarr:','    image: linuxserver/sonarr','    ports: ["[::]:8989:8989"]',
    '  radarr:','    image: linuxserver/radarr','    ports: ["192.168.1.50:7878:7878"]','  lidarr:','    image: linuxserver/lidarr','    ports: ["::1:8686:8686"]',
    '  web:','    image: example/site','    ports: ["8000-8010:8000-8010", "6881-6889:6881-6889/udp"]','  late:','    image: example/late','    ports: ["8100-8200:80"]'].join('\n');
  let r=C.read({name:'compose.yaml',text});
  assert.equal(app(r,'jellyfin').link,null);assert.match(app(r,'jellyfin').note,/needs JF_PORT from \.env/);assert.deepEqual(r.missing,['JF_PORT']);
  assert.deepEqual(app(r,'sonarr').link,{port:8989,https:false,path:'',ip:''});assert.equal(app(r,'radarr').link.ip,'192.168.1.50');
  assert.match(app(r,'lidarr').note,/only listens on the server itself/);assert.equal(port(r,'web'),8000);
  assert.match(r.skipped.find(s=>s.service==='late').why,/different port each time/);
  r=C.read([{name:'compose.yaml',text},{name:'.env',text:'# ports\nJF_PORT=8097 # the usual one is taken\n'}]);assert.equal(port(r,'jellyfin'),8097);assert.deepEqual(r.missing,[]);
});
test('one broken service doesn’t hide the others, and is named with its line',()=>{
  const r=C.read({name:'compose.yaml',text:['services:','  jellyfin:','    image: jellyfin/jellyfin','    ports:','      - 8096:8096','  broken:','    image: "unterminated','    ports:','      - 1234:1234','  sonarr:','    image: linuxserver/sonarr','    ports: [8989:8989]'].join('\n')});
  assert.deepEqual(r.apps.map(a=>a.service),['jellyfin','sonarr']);assert.match(r.skipped[0].why,/quote here is never closed \(line 7 of compose\.yaml\)/);
});
test('docker ps and docker compose ps',()=>{
  const row=(...c)=>c.map((v,i)=>i<c.length-1?v.padEnd([15,40,25,15,22,58][i]):v).join('');
  const text=[row('CONTAINER ID','IMAGE','COMMAND','CREATED','STATUS','PORTS','NAMES'),
    row('3f2a1b4c5d6e','lscr.io/linuxserver/jellyfin:latest','"/init"','2 weeks ago','Up 3 days','0.0.0.0:8096->8096/tcp, :::8096->8096/tcp, 7359/udp','jellyfin'),
    row('9a8b7c6d5e4f','postgres:16','"docker-entrypoint.s…"','2 weeks ago','Up 3 days','5432/tcp','immich_postgres'),
    row('1b2c3d4e5f6a','ghcr.io/immich-app/immich-server:v1','"tini -- /bin/bash s…"','2 weeks ago','Up 3 days (healthy)','0.0.0.0:2283->2283/tcp, [::]:2283->2283/tcp','immich_server'),
    row('aa11bb22cc33','louislam/uptime-kuma:1','"/usr/bin/dumb-init …"','5 months ago','Up 3 days (healthy)','127.0.0.1:3001->3001/tcp','uptime-kuma'),
    row('bb22cc33dd44','example/thing','"run"','1 day ago','Up 1 day','','thing')].join('\n');
  const r=C.read(text);
  assert.deepEqual(r.apps.map(a=>a.service),['jellyfin','immich_server','uptime-kuma']);assert.equal(port(r,'jellyfin'),8096);assert.equal(port(r,'immich_server'),2283);
  assert.match(app(r,'uptime-kuma').note,/only listens/);assert.deepEqual(r.helpers.map(h=>h.service),['immich_postgres']);
  const cps=[row('NAME','IMAGE','COMMAND','SERVICE','CREATED','STATUS','PORTS').replace(/\s+$/,''),row('media-jellyfin-1','jellyfin/jellyfin','"/jellyfin/jellyfin"','jellyfin','1 hour ago','Up 1 hour','0.0.0.0:8097->8096/tcp')].join('\n');
  assert.equal(port(C.read(cps),'jellyfin'),8097);
});
test('one app a line, typed the way people say addresses',()=>{
  const r=C.read('Jellyfin 192.168.1.20:8096\nPhotos - https://photos.example.com\n# the NAS\nnas.home.lan:5000\nRecipes: mealie.home.lan\n[fd00::20]:2283');
  assert.deepEqual(r.apps.map(a=>[a.name,a.link.href]),[['Jellyfin','http://192.168.1.20:8096'],['Photos','https://photos.example.com'],['nas','http://nas.home.lan:5000'],['Recipes','http://mealie.home.lan'],['[fd00::20]:2283','http://[fd00::20]:2283']]);
  assert.equal(r.apps[0].title,'Films and shows','a known app gets its words');
});
test('services copied without "services:", several files, and things that aren’t compose files',()=>{
  const r=C.read([{name:'a.yaml',text:'jellyfin:\n  image: jellyfin/jellyfin\n  ports: ["8096:8096"]'},{name:'b.yaml',text:'services:\n  jellyfin:\n    image: jellyfin/jellyfin\n  photos:\n    image: photoprism/photoprism\n    ports: ["2342:2342"]'}]);
  assert.deepEqual(r.apps.map(a=>a.service),['jellyfin','photos']);assert.equal(app(r,'photos').name,'PhotoPrism');
  const bad=C.read({name:'notes.txt',text:'Remember to buy milk.\nAnd eggs.'});assert.equal(bad.apps.length,0);assert.match(bad.problems[0],/notes\.txt doesn’t look like a compose file/);
});
test('an address label still holding a ${VAR} is no address: the port is used, and the .env is asked for only when nothing else works',()=>{
  const text=['services:','  sonarr:','    image: linuxserver/sonarr','    ports: ["8989:8989"]','    labels:','      - homepage.href=https://sonarr.${DOMAIN}','      - homepage.widget.key=${SONARR_KEY}',
    '  radarr:','    image: linuxserver/radarr','    labels:','      homepage.href: "http://{{HOMEPAGE_VAR_IP}}:7878"','  lidarr:','    image: linuxserver/lidarr','    labels: ["traefik.http.routers.l.rule=Host(`lidarr.${DOMAIN}`)"]',
    '  bazarr:','    image: linuxserver/bazarr','    labels: ["homepage.widget.key=${BAZARR_KEY}"]'].join('\n');
  let r=C.read({name:'compose.yaml',text});
  assert.equal(port(r,'sonarr'),8989);assert.equal(app(r,'radarr').link,null);assert.match(app(r,'lidarr').note,/needs DOMAIN from \.env/);
  assert.equal(app(r,'bazarr').note,'has no port in the file','a widget key is never asked for');assert.deepEqual(r.missing,['DOMAIN']);
  r=C.read([{name:'compose.yaml',text},{name:'.env',text:'DOMAIN=example.com'}]);assert.equal(port(r,'sonarr'),'https://sonarr.example.com');assert.equal(port(r,'lidarr'),'https://lidarr.example.com');
});
test('general service names like "app" and "server" don’t collide between compose files',()=>{
  const r=C.read([{name:'nextcloud/compose.yaml',text:'services:\n  app:\n    image: nextcloud\n    ports: ["8080:80"]\n  db:\n    image: mariadb\n  cron:\n    image: nextcloud\n'},
    {name:'firefly/compose.yaml',text:'services:\n  app:\n    image: fireflyiii/core\n    ports: ["8081:8080"]\n  db:\n    image: mariadb\n'}]);
  assert.deepEqual(r.apps.map(a=>[a.key,a.name,port(r,a.service)&&a.link.port]),[['nextcloud-app','Nextcloud',8080],['firefly-app','Firefly III',8081]]);
  assert.deepEqual(r.helpers.map(h=>h.service),['db','cron']);
  assert.equal(C.read('services:\n  immich-server:\n    image: ghcr.io/immich-app/immich-server\n    ports: ["2283:2283"]').apps[0].key,'immich-server','a name that already says what it is stays as it is');
});
test('docker ps: Compose’s numbered workers and crons are helpers',()=>{
  const row=(...c)=>c.map((v,i)=>i<c.length-1?v.padEnd([15,40,25,15,22,40][i]):v).join('');
  const r=C.read([row('CONTAINER ID','IMAGE','COMMAND','CREATED','STATUS','PORTS','NAMES'),row('a1','ghcr.io/goauthentik/server:2024.8','"dumb-init -- ak…"','1 day ago','Up 1 day','0.0.0.0:9000->9000/tcp','authentik-server-1'),
    row('a2','ghcr.io/goauthentik/server:2024.8','"dumb-init -- ak…"','1 day ago','Up 1 day','9000/tcp','authentik-worker-1'),row('a3','nextcloud:29','"/entrypoint.sh php…"','1 day ago','Up 1 day','80/tcp','nextcloud-cron-1')].join('\n'));
  assert.deepEqual(r.apps.map(a=>a.service),['authentik-server']);assert.deepEqual(r.helpers.map(h=>h.service),['authentik-worker','nextcloud-cron']);
});
test('typed apps use what the catalog knows about their port: https, http, and the path',()=>{
  const r=C.read('Portainer 192.168.1.20:9443\nUniFi 192.168.1.2:8443\nJellyfin nas.fritz.box:8096\nPlex 192.168.1.20:32400\nPi-hole 192.168.1.20\nGrafana https://grafana.example.com/d/home');
  assert.deepEqual(r.apps.map(a=>a.link.href),['https://192.168.1.20:9443','https://192.168.1.2:8443','http://nas.fritz.box:8096','http://192.168.1.20:32400/web','http://192.168.1.20/admin','https://grafana.example.com/d/home']);
});
test('a host_ip that isn’t filled in, nested defaults, and a VPN’s own ports',()=>{
  let r=C.read('services:\n  jellyfin:\n    image: jellyfin/jellyfin\n    ports:\n      - target: 8096\n        published: 8096\n        host_ip: ${LAN_IP}\n');
  assert.equal(app(r,'jellyfin').link,null);assert.match(app(r,'jellyfin').note,/needs LAN_IP from \.env/);
  const nested='services:\n  jellyfin:\n    image: jellyfin/jellyfin\n    ports: ["${JELLYFIN_PORT:-${DEFAULT_PORT:-8096}}:8096"]\n';
  assert.equal(port(C.read(nested),'jellyfin'),8096);assert.equal(port(C.read([{name:'c.yaml',text:nested},{name:'.env',text:'DEFAULT_PORT=8097'}]),'jellyfin'),8097);
  assert.equal(C.sub('$${HOME} ${A:+on} ${B:-x}',{A:'1'}),'${HOME} on x');
  r=C.read(['services:','  gluetun:','    image: qmcgaw/gluetun','    ports:','      - 8888:8888/tcp # HTTP proxy','      - 8388:8388/tcp','      - 8090:8090 # qbittorrent','      - 9117:9117 # jackett','      - 5000:5000 # something',
    '  qbittorrent:','    image: lscr.io/linuxserver/qbittorrent','    network_mode: service:gluetun','  jackett:','    image: lscr.io/linuxserver/jackett','    network_mode: service:gluetun','  thing:','    image: example/thing','    network_mode: "service:gluetun"'].join('\n'));
  assert.equal(port(r,'qbittorrent'),8090);assert.equal(port(r,'jackett'),9117);assert.equal(port(r,'thing'),8090,'an unknown app guesses the first port in order, never the VPN’s proxy');
});
test('two compose files run together without --- are named as the mistake they are',()=>{
  const r=C.read('services:\n  jellyfin:\n    image: jellyfin/jellyfin\n    ports: ["8096:8096"]\nservices:\n  immich-server:\n    image: ghcr.io/immich-app/immich-server\n    ports: ["2283:2283"]\n');
  assert.deepEqual(r.apps.map(a=>a.service),['jellyfin','immich-server'],'both are still read, a section at a time');
  assert.throws(()=>C.yaml('services:\n  a: 1\nservices:\n  b: 2'),/“services” is given twice here\. To read several compose files at once, put a line of three dashes \(---\) between them\. \(line 3\)/);
});
test('behind a VPN or a sidecar, an app keeps its own port; only gluetun keeps ports for itself',()=>{
  let r=C.read('services:\n  gluetun:\n    image: qmcgaw/gluetun\n    ports: ["8080:8080", "8090:8090", "6881:6881"]\n  sabnzbd:\n    image: lscr.io/linuxserver/sabnzbd\n    network_mode: service:gluetun\n  qbittorrent:\n    image: lscr.io/linuxserver/qbittorrent\n    network_mode: service:gluetun\n');
  assert.equal(port(r,'sabnzbd'),8080);
  r=C.read('services:\n  tailscale:\n    image: tailscale/tailscale\n    ports: ["8000:8000"]\n  paperless:\n    image: ghcr.io/paperless-ngx/paperless-ngx\n    network_mode: service:tailscale\n');
  assert.equal(port(r,'paperless'),8000);
});
test('two stacks run together without ---, each with its own anchors, are both read',()=>{
  const stack=(svc,img,p)=>'x-common: &common\n  restart: unless-stopped\nservices:\n  '+svc+':\n    <<: *common\n    image: '+img+'\n    ports: ["'+p+'"]\n';
  const r=C.read(stack('jellyfin','jellyfin/jellyfin','8096:8096')+stack('immich-server','ghcr.io/immich-app/immich-server','2283:2283'));
  assert.deepEqual(r.apps.map(a=>[a.service,a.link.port]),[['jellyfin',8096],['immich-server',2283]]);
});
test('a known app typed with a public name keeps https; two sites both called "web" are two apps',()=>{
  assert.deepEqual(C.read('Vaultwarden vault.example.com\nNextcloud cloud.example.com\nPi-hole 192.168.1.20').apps.map(a=>a.link.href),['https://vault.example.com','https://cloud.example.com','http://192.168.1.20/admin']);
  const r=C.read([{name:'blog/compose.yaml',text:'services:\n  web:\n    build: .\n    ports: ["8081:80"]\n'},{name:'wiki/compose.yaml',text:'services:\n  web:\n    build: .\n    ports: ["8082:3000"]\n'}]);
  assert.deepEqual(r.apps.map(a=>[a.key,a.link.port]),[['web-8081',8081],['web-8082',8082]]);
});
console.log(passed+' compose checks passed');
