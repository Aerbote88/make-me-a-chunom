# make-me-a-chunom

A stroke order editor for Vietnamese Chữ Nôm (𡨸喃) characters.

Based on [make-me-a-hanzi](https://github.com/skishore/makemeahanzi) and [make-me-a-hanzi-tool](https://github.com/MadLadSquad/make-me-a-hanzi-tool), upgraded to **Meteor 3.x** for modern compatibility.

## Features

- Create stroke order data for Chữ Nôm characters (including CJK Extension B/C/D)
- Export to hanzi-writer compatible format
- Docker-based setup for easy deployment

## Quick Start (Docker)

```bash
# Start the editor
docker compose up --build

# Open in browser
http://localhost:3000/#家
```

## Manual Setup

1. Install [Meteor](https://www.meteor.com/install):
   ```bash
   curl https://install.meteor.com/ | sh
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the editor:
   ```bash
   meteor run
   ```

4. Open `http://localhost:3000/#家` in your browser

## Editor Workflow

1. **Path** - Load character outline from font (AR PL UKai or AR PL KaitiM GB)
2. **Bridges** - Define stroke boundaries by connecting points
3. **Strokes** - Verify and select correct strokes
4. **Analysis** - Set decomposition, radical, and etymology
5. **Order** - Draw median lines for each stroke (animation path)
6. **Verified** - Mark as complete and save

## Keybindings

| Key | Action |
|-----|--------|
| `S` | Next stage |
| `W` | Previous stage |
| `D` | Next character |
| `A` | Previous character |
| `R` | Reset current stage |
| `E` | Next verified character |
| `Q` | Previous verified character |

## Export Data

In the browser console:

```javascript
Meteor.call('export')
```

This creates:
- `graphics.txt` - Stroke paths and medians (for hanzi-writer)
- `dictionary.txt` - Definitions, decomposition, etymology

### Export Individual JSON Files

```bash
cd server
./run.sh
```

Creates individual character files in `server/output/` folder.

## Test Stroke Animations

To preview animations from your local `graphics.txt`:

```bash
python3 -m http.server 8992
```

Then open: http://localhost:8992/test-local.html

Type any character and click **Animate** to verify the stroke data.

## Validate Stroke Data

Validate stroke data files:

```bash
npm run validate
# or
task validate
```

## Data Format

The exported data is compatible with [hanzi-writer](https://github.com/chanind/hanzi-writer):

```json
{
  "character": "家",
  "strokes": ["M 464 824 Q...", ...],
  "medians": [[[451, 856], [534, 814], ...], ...]
}
```

## Credits

- Original data and editor: [skishore/makemeahanzi](https://github.com/skishore/makemeahanzi)
- Editor improvements: [MadLadSquad/make-me-a-hanzi-tool](https://github.com/MadLadSquad/make-me-a-hanzi-tool)
- Fonts: [Arphic Public License](http://ftp.gnu.org/gnu/non-gnu/chinese-fonts-truetype/)

## License

[Arphic Public License](https://www.freedesktop.org/wiki/Arphic_Public_License/)
