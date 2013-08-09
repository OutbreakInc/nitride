#!/bin/sh

# from the IDE root directory, find all files, remove those on the specified blacklist and use cpio (rather than tar) to create a clean tar file to pipe through gzip.
#   the resulting tar.gz can be uploaded to moduleverse or otherwise distributed.
find . | grep -v -E "/\.|\./prepare-module\.sh|/benches|/examples|/test|/tests" | cpio -o --format ustar | gzip -8 > ../nitride.release.tar.gz

echo "Uploading module..."
curl -v --user logiblock -X PUT --upload-file ../nitride.release.tar.gz http://moduleverse.com/v1/modules
echo ""
