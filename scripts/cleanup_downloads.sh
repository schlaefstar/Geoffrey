#!/bin/bash

# Geoffrey Downloads Cleanup Script
# This script helps manage local downloaded files from S3

DOWNLOADS_DIR="backend/downloads"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚪 Geoffrey Downloads Cleanup Script"
echo "======================================"
echo ""

# Check if downloads directory exists
if [ ! -d "$DOWNLOADS_DIR" ]; then
    echo -e "${YELLOW}No downloads directory found at $DOWNLOADS_DIR${NC}"
    exit 0
fi

# Function to get directory size
get_dir_size() {
    du -sh "$1" 2>/dev/null | cut -f1
}

# Function to count events
count_events() {
    find "$1" -mindepth 3 -maxdepth 3 -type d 2>/dev/null | wc -l | tr -d ' '
}

# Display current storage usage
echo "📊 Current Storage Usage:"
echo "------------------------"
TOTAL_SIZE=$(get_dir_size "$DOWNLOADS_DIR")
TOTAL_EVENTS=$(count_events "$DOWNLOADS_DIR")
echo -e "Total Size: ${GREEN}$TOTAL_SIZE${NC}"
echo -e "Total Events: ${GREEN}$TOTAL_EVENTS${NC}"
echo ""

# Menu
echo "Cleanup Options:"
echo "1) Delete all downloads"
echo "2) Delete downloads older than X days"
echo "3) Delete specific month"
echo "4) Delete specific event"
echo "5) Show storage breakdown by month"
echo "6) Exit"
echo ""
read -p "Select option (1-6): " option

case $option in
    1)
        echo ""
        read -p "⚠️  Delete ALL downloads? This cannot be undone! (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            rm -rf "$DOWNLOADS_DIR"/*
            echo -e "${GREEN}✓ All downloads deleted${NC}"
        else
            echo "Cancelled"
        fi
        ;;
    
    2)
        echo ""
        read -p "Delete downloads older than how many days? " days
        if ! [[ "$days" =~ ^[0-9]+$ ]]; then
            echo -e "${RED}Invalid number${NC}"
            exit 1
        fi
        
        echo ""
        echo "Finding downloads older than $days days..."
        OLD_DIRS=$(find "$DOWNLOADS_DIR" -mindepth 3 -maxdepth 3 -type d -mtime +$days)
        COUNT=$(echo "$OLD_DIRS" | grep -c '^' 2>/dev/null || echo "0")
        
        if [ "$COUNT" -eq 0 ]; then
            echo "No downloads older than $days days found"
        else
            echo "Found $COUNT events older than $days days"
            echo ""
            read -p "Delete these events? (yes/no): " confirm
            if [ "$confirm" = "yes" ]; then
                echo "$OLD_DIRS" | while read dir; do
                    if [ -n "$dir" ]; then
                        rm -rf "$dir"
                        echo "Deleted: $dir"
                    fi
                done
                echo -e "${GREEN}✓ Deleted $COUNT events${NC}"
            else
                echo "Cancelled"
            fi
        fi
        ;;
    
    3)
        echo ""
        echo "Available months:"
        find "$DOWNLOADS_DIR" -mindepth 2 -maxdepth 2 -type d | sort
        echo ""
        read -p "Enter year (e.g., 2025): " year
        read -p "Enter month (e.g., 11): " month
        
        MONTH_DIR="$DOWNLOADS_DIR/$year/$month"
        if [ ! -d "$MONTH_DIR" ]; then
            echo -e "${RED}Month directory not found: $MONTH_DIR${NC}"
            exit 1
        fi
        
        MONTH_SIZE=$(get_dir_size "$MONTH_DIR")
        MONTH_EVENTS=$(count_events "$MONTH_DIR")
        echo ""
        echo "Month: $year/$month"
        echo "Size: $MONTH_SIZE"
        echo "Events: $MONTH_EVENTS"
        echo ""
        read -p "Delete this month? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            rm -rf "$MONTH_DIR"
            echo -e "${GREEN}✓ Deleted $year/$month${NC}"
        else
            echo "Cancelled"
        fi
        ;;
    
    4)
        echo ""
        read -p "Enter year (e.g., 2025): " year
        read -p "Enter month (e.g., 11): " month
        read -p "Enter event ID: " event_id
        
        EVENT_DIR="$DOWNLOADS_DIR/$year/$month/$event_id"
        if [ ! -d "$EVENT_DIR" ]; then
            echo -e "${RED}Event not found: $EVENT_DIR${NC}"
            exit 1
        fi
        
        EVENT_SIZE=$(get_dir_size "$EVENT_DIR")
        FILE_COUNT=$(find "$EVENT_DIR" -type f | wc -l | tr -d ' ')
        echo ""
        echo "Event: $event_id"
        echo "Size: $EVENT_SIZE"
        echo "Files: $FILE_COUNT"
        echo ""
        read -p "Delete this event? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            rm -rf "$EVENT_DIR"
            echo -e "${GREEN}✓ Deleted event $event_id${NC}"
        else
            echo "Cancelled"
        fi
        ;;
    
    5)
        echo ""
        echo "📊 Storage Breakdown by Month:"
        echo "------------------------------"
        find "$DOWNLOADS_DIR" -mindepth 2 -maxdepth 2 -type d | sort | while read month_dir; do
            month_path=$(echo "$month_dir" | sed "s|$DOWNLOADS_DIR/||")
            size=$(get_dir_size "$month_dir")
            events=$(count_events "$month_dir")
            printf "%-15s %10s %8s events\n" "$month_path" "$size" "$events"
        done
        echo ""
        ;;
    
    6)
        echo "Exiting..."
        exit 0
        ;;
    
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac
