#!/bin/bash

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <file1> <file2>"
    exit 1
fi

file1="output/transcripts/raw/$1.txt"
file2="output/transcripts/structured/$1.md"

if [ ! -f "$file1" ]; then
    echo "File does not exist: $file1"
    exit 1
fi

if [ ! -f "$file2" ]; then
    echo "File does not exist: $file2"
    exit 1
fi

size1=$(wc -c < "$file1" | tr -d ' ')
size2=$(wc -c < "$file2" | tr -d ' ')

if ! [[ "$size1" =~ ^[0-9]+$ ]] || ! [[ "$size2" =~ ^[0-9]+$ ]]; then
    echo "Error: Could not determine file size."
    exit 1
fi

echo "Size of $file1: $size1 bytes"
echo "Size of $file2: $size2 bytes"

