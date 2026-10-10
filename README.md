# Clay Studio · Sculpting Lab 0.3

Shape a real webpage by hand: grab a piece, push a brush through the layout, grow cards, or draw a path for them to follow. The editor uses geometry, DOM measurements, and CSS. No AI service or account is required.

## Run locally

Install Python 3 if it is not already available, then double-click `START-CLAY.cmd` on Windows. Open **http://127.0.0.1:8920** while the server window is running.

On any platform, run this from the project folder:

```sh
python serve.py
```

An optional port argument is supported: `python serve.py 8921`. The server listens on this computer only, and keeps your pages in the `data` folder here. Python's standard library is sufficient; there are no packages to install.

## Run on a server (Docker)

To keep Clay running on a home server and use it from your laptop or any other computer on your network:

```sh
git clone https://github.com/NovasPlace/clay-studio.git
cd clay-studio
docker compose up -d
```

Then open **http://your-server's-address:8920**. It restarts with the server, and your pages are kept in the `clay-studio_clay-data` volume.

Anyone who can reach that port can edit. To ask for a password (any user name works), create a file called `.env` next to `compose.yaml` containing `CLAY_PASSWORD=your-password`, then run `docker compose up -d` again. Keep it on your home network: to reach it from outside, put it behind a reverse proxy with HTTPS rather than opening the port to the internet.

Without Docker, the same settings work directly: `python serve.py --host 0.0.0.0` listens on your network, and the environment variables `CLAY_PASSWORD`, `CLAY_PORT` and `CLAY_DATA` (the folder for your pages) work the same way. `python serve.py --help` lists them.

Pages, and their undo history, are saved on the server as you work, so every computer on your network sees the same page. If two computers edit the same page at once, the one that saves second is told to reload rather than overwrite the other's work.

## Try it

The server opens on **Your pages**. Choose **New page**, give it a name, and start from a simple page, **Home server links** (a card for each app you run at home, for the family to click), or the Clay sample. Each page card can be renamed, duplicated or deleted; a deleted page goes to the trash, with an Undo, and stays in `data/trash` until you remove it yourself. In the editor, **← Pages** goes back to the list.

To link pages together, grab a button or card and press **K** (or **Add + → Link to…**), then choose one of your pages, a part of this page, or type a web address. In a piece with several links, such as the navigation bar, click the link you mean first. A bare name or a home network address like `192.168.1.20:8096` gets `http://`; anything else gets `https://`. In **View site**, links to your other pages take you there, still in View site.

1. **Grab** a card or the header/footer. Pull the green corner to resize. Full-width regions can move vertically; narrow them to make room for sideways movement.
2. Turn on **Magnets**, then drag the small caption near a card edge. Release when the attachment hint appears. The two pieces now move together. Hold **Shift** for free placement.
3. Choose **Group** and drag a box or draw a loop around at least two piece centers. Grab any member to move the group, or stretch its corner.
4. With a group selected, choose **Peel a piece** and pull a member at least 56 pixels to release it. **Ungroup** releases every member in place. Undo restores the relationship.
5. Try **Push**, **Grow**, **Flow**, **Tidy**, **Paint**, and **Pin**. Grow upward to enlarge and downward to shrink. Tidy eases nearby rows and excessive gaps. Pin holds a piece or group still.
6. Double-click words to edit them. Use **Add +** for text, cards, buttons, images, or more canvas. With a picture selected, **Add + → Replace image** swaps it in the same place and size; dropping an image file onto a picture does the same.
   With an SVG drawing selected, **Add + → Split drawing** turns each of its top-level groups into its own piece, in exactly the same place. The pieces stay together as one drawing (Grab moves it whole, and on a phone it scales as one picture); **Peel a piece** or Alt-drag pulls one out. To prepare a drawing, put each part you want to move in its own top-level `<g>`, and give it an `id` such as `sea-star`: that becomes the piece's name and description.
7. Choose **Phone** to inspect the stacked layout, **View site** to use the actual links, or **Export** to save a standalone page.
8. Bring pieces to life in **Layout tools**. Select a piece and pick an **Idle** motion (Float, Bob, Sway, Breathe, Spin, Scuttle), or type "float" in Ctrl+K. Each piece starts at its own point in the loop; motion pauses while a piece is held, and people who ask their device for reduced motion get none. For a hover reveal, set a detail's **Opacity** to 0, then select its card, choose **Hover**, click the detail and set it back to 100: the detail appears when the card is hovered, and touch screens simply show it. Hover can also **Grow** or **Tilt** a piece. Motion and reveals are plain CSS in the exported page; no JavaScript.
9. Fuse and morph. With a group selected, **Goo** melts its pieces together where they come close, like wax in a lava lamp; words and pictures stay crisp on top, and **Drift** motion keeps them meeting and parting. **Scatter** sends a group's pieces a little way out, turned, and brings them home one after another when the pointer reaches the group: a split drawing assembles itself. A piece covering half the group or more is its backdrop and stays put; touch screens, phones and reduced motion see the group whole. **Assemble on scroll** is Scatter's other way home, and it works on phones: the pieces wait apart and fly home one after another as the page scrolls the group into view, all of them once the whole group is on the screen (so even a group at the very end of a page gets there), and they come apart again when you scroll back up. It's plain CSS (scroll-driven animations); browsers without them, and reduced motion, show the group whole. For it to follow the page's scroll, the page's own root clips with `overflow: clip` rather than `overflow: hidden`. Choosing Scatter or Assemble on scroll switches between the two; choosing the one that's on gathers the group. Peeling or ungrouping gathers it first; grouping it with more pieces scatters the new group the same way. In Layout tools, every **Carve** (now with **Blob** and **Diamond**) morphs into every other: carve a card one way normally and another way in **Hover**, and it reshapes between the two. A carve that only exists on hover grows out of the plain box, and touch screens show the hover shape. All of it is CSS and one small inline SVG filter in the exported page.
10. Act it out. Choose **Act** (A), hold a piece and move it the way it should move: scuttle it left, pause, hop, and let go. From then on it does exactly that, pauses and all, in the exported page too, as plain CSS keyframes. Let go back where you started (the green ring) and it loops; let go anywhere else and it swings back and forth. It stays within 140 pixels of home (the dashed ring). Everything else keeps moving while you act, so takes layer like a loop pedal, and each take is one Undo. A part of a split drawing acts on its own and a piece of any other group acts with its group; hold **Alt** for the other way. Double-click with Act to still a piece. Like idle motion, it pauses while a piece is held with Grab, and people who ask their device for reduced motion see it still.

**Make room** moves neighboring pieces aside where space permits, to make room for what you are moving; pieces that were already close together before the gesture stay as they are. Only pieces a gesture actually moves or resizes are rewritten. Text and cards retain minimum dimensions. Crowded layouts can still run out of room; the editor reports that explicitly. Groups are handled as rectangular units, including the space between members.

The navigation, story section, and footer can all be grabbed in Sculpt. Their internal contents remain part of each region; Layout tools provide finer structural controls. In Layout tools, the pieces on the canvas can be selected and styled, and their contents rearranged; the pieces themselves are placed in Sculpt.

## Save and share

Pages made from **Your pages** save on the server as you work (see above). Pages opened any other way, such as `index.html` on its own, autosave in this browser for this address, with their Undo history, so Undo still works after you reopen the page (the most recent steps are kept as storage allows). The page itself always saves first: if browser storage runs short, older history makes way. Big photos are scaled down to 1600 pixels when added or replaced, so pages stay a sensible size. A different port or browser has a separate saved workspace. Use **Export → Save HTML file → Download HTML** for a portable copy. The server also keeps exported pages in `data/exports`.

**Export site** on Your pages saves every page at once: each as `<name>.html`, with links between your pages pointing at those files, and the home page you choose also as `index.html`, the page a web host shows first. You get a folder to open in the browser and a `.zip` to upload to any web host or open from your computer; both stay in `data/exports`. If a page links to one that has since been deleted, the export says which.

Exported pages contain real HTML and CSS and work without Python, the editor, or a network connection. Groups keep their members together in the phone reading order. `examples/grouped-page.html` is a browser-verified export.

**For an agent** exports a text description of the changes and group membership alongside the HTML/CSS options, for an agent to apply to a site's own source files. To work on a page together, live, see below.

## Build with an agent

An agent such as Claude Code or Codex can read a page and change it while you work on it. Its changes appear in your editor as they happen, labelled with its name and what it says it did (“Claude: made the cards three across”), the pieces it touched light up briefly, and Undo takes each change back like one of your own. Clay itself has no AI in it and needs no account: the agent is whatever you already use.

In the editor, choose **Agent**. It shows what to set up, with this server's address and its key filled in:

- **Claude Code:** one command, `claude mcp add --transport http clay http://<server>:8920/mcp --header "Authorization: Bearer <key>"`.
- **Codex** (or anything whose MCP setup runs a program): save `clay-mcp.py` from the dialog (it needs Python, nothing else), and add `[mcp_servers.clay]` to `~/.codex/config.toml` with `command = "python"`, `args = ["/path/to/clay-mcp.py"]` and `env = { CLAY_URL = "http://<server>:8920", CLAY_AGENT_KEY = "<key>" }`.

Then ask, for example, “In Clay, line up the cards on my home page and link Photos to the About page”. The agent can list your pages, make new ones, and read and change any of them **while Clay is open in your browser**: any page, or just the page list, as long as it is showing. A page you have open shows its changes as they happen. One you don't is opened out of sight in that tab (which says who is working where, and what they did) and closes again after two minutes without changes, or when you open the page yourself; its changes are saved before the agent hears back, and are in the page's history when you open it. If Clay isn't open anywhere, the agent is told to ask you to open it. It works in Clay's own terms: place a piece (position and size in pixels), change words (a card's label, title and words are separate parts), link something to a page, a part of the page or a web address, add a piece (best copied from one already on the page, so it matches), remove, paint, pin, group and ungroup, and make the page taller. Everything in one request is one step, and either all of it happens or none of it does. If you are in the middle of dragging something, its change waits until you let go.

The key lets an agent in without the password, so treat it like one. **Make a new key** in the Agent dialog shuts out anything using the old one. Scripts can use the same thing without MCP: `GET /api/agent/pages`, `POST /api/agent/pages` with `{"title", "from"}`, `GET /api/agent/pages/<name>` to read, and `POST /api/agent/pages/<name>` with `{"actions": [...], "say": "...", "as": "..."}` to change, each with `Authorization: Bearer <key>`.

## Keyboard controls

| Action | Key |
| --- | --- |
| Grab / Group | G / B |
| Push / Grow | U / R |
| Flow / Tidy | F / S |
| Paint / Pin | P / N |
| Act / still a piece | A / double-click with Act |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y |
| Nudge selected piece | Arrow keys; Shift for larger steps |
| Delete selected piece | Delete; Undo restores it |
| Link the selected button or card | K |
| Cancel stroke / clear selection | Escape |
| Free placement | Hold Shift while dragging |
| Peel a group member | Peel button, or Alt-drag |

Sculpting is intended for a desktop-width viewport. The phone view is a responsive preview, not a touch editing mode.

## Development

Plain JavaScript, CSS, HTML, and a small Python preview/export server. No build step. Node.js is only needed to run the development checks:

```sh
npm test
npm run check
npm run test:server
```

- `studio.js`: original layout editor plus the bridge used by Sculpt, undo, persistence, and export.
- `sculpt-core.js`: pure geometry and constraint functions.
- `relations.js`: real DOM grouping, attachment, peeling, and group resizing.
- `sculpt.js` / `sculpt-ui.css`: direct manipulation controls and feedback.
- `agent.js`: building together: applies an agent's requests in the open editor, and the Agent dialog. `host.js`: lets any Clay tab that is showing open pages out of sight for an agent. `clay-mcp.py`: MCP for setups that run a program.
- `pages.html`: the page list and Export site; `starters/`: what a new page starts from; `index.html`: sculptable example page (also the Clay sample starter); `classic.html`: original layout editor example.
- `serve.py`: your pages, the editor, export, the agent channel and MCP, and settings (network, password, data folder); `Dockerfile` and `compose.yaml` run it on a server.
- `qa/`: geometry, relationship and server regression checks.

See `VERIFICATION.txt` for tested behavior and current limits. This is a prototype. Mobile touch editing and arbitrary-site import are not provided.

## Repository

A private prototype repository. Source, regression checks, example export, evidence, and launch instructions are included. Runtime exports and local caches are ignored. No license has been chosen yet, so all rights are reserved.

![Sculpt editor with attached and grouped pieces](docs/evidence/editor.png)
