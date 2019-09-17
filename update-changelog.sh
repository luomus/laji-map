#!/bin/bash

version=$(npm version | head -n 1 | awk '{print $3}' | sed "s/[\',]//g")
echo $version
vim -c "execute \"+normal! O## $version\<cr>\<cr>\<esc>k\""  -c startinsert CHANGELOG.md
git add CHANGELOG.md
