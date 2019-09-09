#!/bin/bash

version=$(npm version | head -n 2 | tail -n 1 |awk '{print $2}' | sed "s/[\',]//g")
echo $version
vim -c "execute \"+normal! O## $version\<cr>\<cr>\<esc>k\""  -c startinsert CHANGELOG.md
git add CHANGELOG.md
