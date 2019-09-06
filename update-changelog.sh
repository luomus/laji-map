#!/bin/bash

version=$(cat $DIR/package.json | grep "\"version" |awk '{print $2}' | sed 's/[",]//g')
vim -c "execute \"+normal! O## $version\<cr>\<cr>\<esc>k\""  -c startinsert $DIR/CHANGELOG.md
git add $DIR/CHANGELOG.md
