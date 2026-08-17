Drop profile picture images in this folder, then list them in manifest.json
(in this same folder) so the game knows what to offer as avatar choices.

Steps:
1. Add image files here, e.g. fox.png, robot.png, ghost.png (square images work best, any size - they'll be scaled to circles).
2. Edit manifest.json in this folder and add the filename for each one, e.g.:

   [
     "fox.png",
     "robot.png",
     "ghost.png"
   ]

3. Restart the server. The profile picture picker on the name-entry screen
   will automatically show every image listed in manifest.json.

Until you do this, the game uses simple built-in colored emoji avatars as
placeholders, so it's fully playable right away.
