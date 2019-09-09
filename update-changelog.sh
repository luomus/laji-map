#!/bin/bash

version=$(cat package.json | grep "\"version" |awk '{print $2}' | sed 's/[",]//g')
vim -c "execute \"+normal! O## $version\<cr>\<cr>\<esc>k\""  -c startinsert CHANGELOG.md
git add CHANGELOG.md
