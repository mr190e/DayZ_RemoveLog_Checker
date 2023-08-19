# DayZ_RemoveLog_Checker
This script attachs to DayZ adm log file and searches for REMOVE events. It than parses the log line and performs an analysis and sends a warning to a Discord channel of your choice

As this script parses the REMOVE events from the log file, you can define storage types where you want to send summeries of what was taken from them, i. e. keyroom loot. 

The "channelId" is the Discord Channel where REMOVE events are send when a min-distance was reached.

The "WatchStorageType_Channel" is the channel where you want to forward the declared summeries.
