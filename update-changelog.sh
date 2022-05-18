#!/bin/bash

read -p "Do you want to update the readme? y/[n] " yn

case $yn in
	[Yy]*)
		read -p "Enter program to edit with (defaults to vim): " prog
		if [[ -z $prog ]]; then
			version=$(npm version | head -n 2 | tail -n 1 | awk '{print $2}' | sed "s/[\',]//g")
			vim -c "execute \"+normal! O## $version\<cr>\<cr>\<esc>k\""  -c startinsert CHANGELOG.md
		else
			$prog CHANGELOG.md
		fi
		git add CHANGELOG.md
		exit;;
	[Nn]*)
		exit;;
esac
