# A simple set of words to block.
# Using a set is faster for checking if a word exists than using a list.
# We are storing them in lowercase to make the check case-insensitive.

BLOCKLIST = {
    # English Profanity
    "fuck",
    "bitch",
    "asshole",
    "motherfucker",
    "cunt",
    "dick",
    "pussy",
    "shit",
    "damn",
    
    # Add any other words you want to explicitly block
}