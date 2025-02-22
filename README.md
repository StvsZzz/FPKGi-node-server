# FPKGi-node-server
A simple package server to work with the FPKGi PS4 client. This autogenerates the PS4 package meta and serves compatible JSON files dynamically.

## How to use?
- Install NodeJS from https://nodejs.org/en/download
- Download the files in this repository to a folder and open command or terminal in the same directory. Run `npm install` to install the NodeJS dependency (express)
- Edit the `config.json` file and add the IP address of your PC/Server this is being ran on. (same network as the PS4)
- Run the `Start Server.bat` or to run from terminal: `node server` in the same directory.
- On first run it will generate the folder structure needed to serve packages. Place your fpkgs in the relevant folders to structure the data.

You should now be able to visit the local webserver it generates, which should give you direct links to the auto-generated JSON files, please see FPKGi instructions on how to add these to your client. A basic preview library is available by clicking the 'eye' icon on the right hand side of the categories. 

If you need to refresh or rescan the packages (e.g. adding a new package whilst the server is running) you can visit `/refresh` to instruct the server to refresh the packages. 

## Notes
- The background feature and cover-images are currently broken, however this seems like a client issue and it is correctly implemented in this server. This should be fixed in the next FPKGi client update.
- I have no experience in handling pkg files, this is a first-attempt at getting metadata extracted in NodeJS. If there is a package that doesn't process I would appreictate a message.
- This is a hobby project, may or may not be worked on in spare time. Updates may be sporadic, to be used for self-hosting package deployment on your local network and not to be used over the internet - there is no security or authentication. It's just a glorified file-server with JSON listings.
