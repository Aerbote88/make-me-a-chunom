# make-me-a-hanzi-tool
A (probably) working version of the make-me-a-hanzi tool.

Building:

1. Install mongodb
1. Install node and run `npm i`
1. Install meteor using the following command:
    ```sh
    curl https://install.meteor.com/ | sh
    ```
1. Run `meteor run`

Editor usage:

1. Append a "#", followed by the character you want to edit in the URL like this: `localhost:3000/#A`. Open the URL in the browser
2. Write any data for your character if it doesn't exist
3. Select one of the 2 fonts from the list to edit your character
4. Go trough the tool
5. Keybindings:
    1. S - Go to the next page of the editor
    2. W - Go to the previous page
    3. R - Clear changes in the stroke editor
    4. N - Next character
6. Note: When cutting 2 intersecting strokes, create 1 or 2 rectangles in the overlapped area when cutting. If any unneeded strokes appear deselect them

## Additional script usage for Youyin
In addition to improving the editor, we've also added scripts to make generating data for [youyin](https://github.com/MadLadSquad/YouyinWeb) and 
[hanzi-writer](https://github.com/chanind/hanzi-writer) easier. All scripts are located under the `server/` directory because that's where the character data is generated.

- `process.py` - Reads the `make-me-a-hanzi` dictionary from the characters you have created and converts it to individual character files in `hanzi-writer` format under the `output` folder. Do not use directly, use `run.sh` instead
- `run.sh` - Gets the character data from the meteor database, exports it to `tmp.json`, which is used as a `make-me-a-hanzi` dictionary file. It then runs `process.py`

### `youyin-dev-run.sh`
This script runs `./run.sh` for Youyin development. First, make sure you have the following repositories cloned in the same folder without renames:

- make-me-a-hanzi-tool
- [YouyinWeb](https://github.com/MadLadSquad/YouyinWeb)
- [hanzi-writer-data-youyin](https://github.com/MadLadSquad/hanzi-writer-data-youyin)

Create a symbolic link so that `hanzi-writer-data-youyin/data/` points to `YouyinWeb/data/`: `ln -s YouyinWeb/data/ hanzi-writer-data-youyin/data/`

Next, edit `YouyinWeb/index.js` and change the `window.CHARACTER_FETCH_URL` string to `"http://0.0.0.0:8080/data/"`

With this setup, you can test characters. Now, every time you have finished a batch of characters, go into the `make-me-a-hanzi-tool/server` directory and run `./youyin-dev-run.sh`. It will:

- Create `hanzi-writer` character files, like `run.sh`
- Copy them to `hanzi-writer-data-youyin/data`
- Go into `YouyinWeb` and run `./run.sh` to start the server.
- Finally, open Youyin locally on `http://0.0.0.0:8080` and try creating character cards with the new characters.

Once all characters are working and generated correctly, simply go to the `hanzi-writer-data-youyin` directory, commit and push the changes.
