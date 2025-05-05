#!/bin/sh

# Save the current branch name
current_branch=$(git rev-parse --abbrev-ref HEAD)

# check if a remote named boot already exists, and only add it if it doesn't
git remote get-url lite 2>/dev/null || git remote add lite git@github.com:mehery-soccom/scriptus.lite.git

# Fetch all branches from the 'boot' remote
git fetch lite

# Check if local branch 'lite_$current_branch' exists
if git show-ref --verify --quiet refs/heads/lite_"$current_branch"; then
    # If it exists, just check it out
    git checkout lite_"$current_branch"
else
    # If it doesn't exist, create it from lite/build-xyz
    git checkout -b lite_"$current_branch" lite/"$current_branch"
fi

git pull --rebase lite "$current_branch"

git checkout "$current_branch"

git pull --rebase origin "$current_branch"


git merge lite_"$current_branch"



