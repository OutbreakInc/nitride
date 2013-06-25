Until there are some proper docs for Nitride or the Logiblock IDE in general, this will have to do:

What is this?  An IDE in development for embedded hardware, specifically Galago (available on Logiblock.com and as seen on Kickstarter)

Demo: http://www.youtube.com/watch?v=U9P2MuBE4iI

How do you use this thing?  This repo is the contents of an app.nw bundle used in node-webkit.

It will not function correctly unless you have both the logiblock/platform and logiblock/sdk-arm-gcc-mac64 (or ...-linux64 or ...-win32) moduleverse modules installed.  They're freely available but there's no easy or obvious way to install them at the moment.  See http://logiblock.com/ide for more details that may be useful prior to release.