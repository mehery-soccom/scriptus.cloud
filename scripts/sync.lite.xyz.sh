#!/bin/sh

# check if a remote named boot already exists, and only add it if it doesn't
git remote get-url lite 2>/dev/null || git remote add boot git@github.com:mehery-soccom/scriptus.lite.git

# Fetch all branches from the 'boot' remote
git fetch lite

# Check if local branch 'boot_master' exists
if git show-ref --verify --quiet refs/heads/lite_xyz; then
    # If it exists, just check it out
    git checkout lite_xyz
else
    # If it doesn't exist, create it from boot/master
    git checkout -b lite_xyz lite/build-xyz
fi

git pull --rebase lite xyz

git checkout master

git pull --rebase origin master


git merge lite_xyz



