# Clay Studio · Sculpting Lab 0.3

Shape a real webpage by hand: grab a piece, push a brush through the layout, grow cards, or draw a path for them to follow. The editor uses geometry, DOM measurements, and CSS. No AI service or account is required.

## Run locally

Install Python 3 if it is not already available, then double-click `START-CLAY.cmd` on Windows. Open **http://127.0.0.1:8920/index.html** while the server window is running.

On any platform, run this from the project folder:

```sh
python serve.py
```

An optional port argument is supported: `python serve.py 8921`. The server listens on this computer only. Python's standard library is sufficient; there are no packages to install.

## Run on a server (Docker)

To keep Clay running on a home server and use it from your laptop or any other computer on your network:

```sh
git clone https://github.com/NovasPlace/clay-studio.git
cd clay-studio
docker compose up -d
```

Then open **http://your-server's-address:8920**. It restarts with the server, and saved pages are kept in the `clay-studio_clay-data` volume.

Anyone who can reach that port can edit. To ask for a password (any user name works), create a file called `.env` next to `compose.yaml` containing `CLAY_PASSWORD=your-password`, then run `docker compose up -d` again. Keep it on your home network: to reach it from outside, put it behind a reverse proxy with HTTPS rather than opening the port to the internet.

Without Docker, the same settings work directly: `python serve.py --host 0.0.0.0` listens on your network, and the environment variables `CLAY_PASSWORD`, `CLAY_PORT` and `CLAY_DATA` (the folder for saved pages) work the same way. `python serve.py --help` lists them.

For now, your work in progress autosaves in each browser, so continue a page in the browser you started it in; exported pages are saved on the server and open anywhere.

## Try it

1. **Grab** a card or the header/footer. Pull the green corner to resize. Full-width regions can move vertically; narrow them to make room for sideways movement.
2. Turn on **Magnets**, then drag the small caption near a card edge. Release when the attachment hint appears. The two pieces now move together. Hold **Shift** for free placement.
3. Choose **Group** and drag a box or draw a loop around at least two piece centers. Grab any member to move the group, or stretch its corner.
4. With a group selected, choose **Peel a piece** and pull a member at least 56 pixels to release it. **Ungroup** releases every member in place. Undo restores the relationship.
5. Try **Push**, **Grow**, **Flow**, **Tidy**, **Paint**, and **Pin**. Grow upward to enlarge and downward to shrink. Tidy eases nearby rows and excessive gaps. Pin holds a piece or group still.
6. Double-click words to edit them. Use **Add +** for text, cards, buttons, images, or more canvas. With a picture selected, **Add + → Replace image** swaps it in the same place and size; dropping an image file onto a picture does the same.
   With an SVG drawing selected, **Add + → Split drawing** turns each of its top-level groups into its own piece, in exactly the same place. The pieces stay together as one drawing (Grab moves it whole, and on a phone it scales as one picture); **Peel a piece** or Alt-drag pulls one out. To prepare a drawing, put each part you want to move in its own top-level `<g>`, and give it an `id` such as `sea-star`: that becomes the piece's name and description.
7. Choose **Phone** to inspect the stacked layout, **View site** to use the actual links, or **Export** to save a standalone page.
8. Bring pieces to life in **Layout tools**. Select a piece and pick an **Idle** motion (Float, Bob, Sway, Breathe, Spin, Scuttle), or type "float" in Ctrl+K. Each piece starts at its own point in the loop; motion pauses while a piece is held, and people who ask their device for reduced motion get none. For a hover reveal, set a detail's **Opacity** to 0, then select its card, choose **Hover**, click the detail and set it back to 100: the detail appears when the card is hovered, and touch screens simply show it. Hover can also **Grow** or **Tilt** a piece. Motion and reveals are plain CSS in the exported page; no JavaScript.
9. Fuse and morph. With a group selected, **Goo** melts its pieces together where they come close, like wax in a lava lamp; words and pictures stay crisp on top, and **Drift** motion keeps them meeting and parting. **Scatter** sends a group's pieces a little way out, turned, and brings them home one after another when the pointer reaches the group: a split drawing assembles itself. A piece covering half the group or more is its backdrop and stays put; touch screens, phones and reduced motion see the group whole. Peeling or ungrouping gathers it first. In Layout tools, every **Carve** (now with **Blob** and **Diamond**) morphs into every other: carve a card one way normally and another way in **Hover**, and it reshapes between the two. A carve that only exists on hover grows out of the plain box, and touch screens show the hover shape. All of it is CSS and one small inline SVG filter in the exported page.

**Make room** moves neighboring pieces aside where space permits, to make room for what you are moving; pieces that were already close together before the gesture stay as they are. Only pieces a gesture actually moves or resizes are rewritten. Text and cards retain minimum dimensions. Crowded layouts can still run out of room; the editor reports that explicitly. Groups are handled as rectangular units, including the space between members.

The navigation, story section, and footer can all be grabbed in Sculpt. Their internal contents remain part of each region; Layout tools provide finer structural controls. In Layout tools, the pieces on the canvas can be selected and styled, and their contents rearranged; the pieces themselves are placed in Sculpt.

## Save and share

Completed edits autosave in this browser for this local address, with their Undo history, so Undo still works after you reopen the page (the most recent steps are kept as storage allows). The page itself always saves first: if browser storage runs short, older history makes way. Big photos are scaled down to 1600 pixels when added or replaced, so pages stay a sensible size. A different port or browser has a separate saved workspace. Use **Export → Save HTML file → Download HTML** for a portable copy. The local server also places saved pages in `exports/`.

Exported pages contain real HTML and CSS and work without Python, the editor, or a network connection. Groups keep their members together in the phone reading order. `examples/grouped-page.html` is a browser-verified export.

**For an agent** exports a text description of the changes and group membership alongside the HTML/CSS options. This is a handoff aid; it is not a live agent connection or an AI feature.

## Keyboard controls

| Action | Key |
| --- | --- |
| Grab / Group | G / B |
| Push / Grow | U / R |
| Flow / Tidy | F / S |
| Paint / Pin | P / N |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y |
| Nudge selected piece | Arrow keys; Shift for larger steps |
| Delete selected piece | Delete; Undo restores it |
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
- `index.html`: sculptable example page; `classic.html`: original layout editor example.
- `serve.py`: preview, export and settings (network, password, data folder); `Dockerfile` and `compose.yaml` run it on a server.
- `qa/`: geometry, relationship and server regression checks.

See `VERIFICATION.txt` for tested behavior and current limits. This is a single-page prototype. Mobile touch editing, multi-page project management, and arbitrary-site import are not provided.

## Repository

A private prototype repository. Source, regression checks, example export, evidence, and launch instructions are included. Runtime exports and local caches are ignored. No license has been chosen yet, so all rights are reserved.

![Sculpt editor with attached and grouped pieces](docs/evidence/editor.png)
