# %%
import os
from mem0 import Memory
from dotenv import load_dotenv

# %%
from mem0 import Memory

config = {
    "llm": {
        "provider": "ollama",
        "config": {
            "model": "llama3.2:3b",
            "temperature": 0,
            "ollama_base_url": "http://localhost:11434",
        },
    },
    "embedder": {
        "provider": "ollama",
        "config": {
            "model": "nomic-embed-text",
            "ollama_base_url": "http://localhost:11434",
        },
    },
        "vector_store": {
        "provider": "qdrant",
        "config": {
            "collection_name": "mem0_ollama",
            "embedding_model_dims": 768,
            "path": "qdrant_ollama",
        },
    },
}

try:
    m
except NameError:
    m = Memory.from_config(config)
# %%
messages = [
    {
        "role": "user",
        "content": "I'm planning to watch a movie tonight. Any recommendations?",
    },
    {
        "role": "assistant",
        "content": "How about a thriller movies? They can be quite engaging.",
    },
    {
        "role": "user",
        "content": "I'm not a big fan of thriller movies but I love sci-fi movies.",
    },
    {
        "role": "assistant",
        "content": "Got it! I'll avoid thriller recommendations and suggest sci-fi movies in the future.",
    },
]

result = m.add(
    messages, user_id="default_user", metadata={"category": "movie_recommendations"}
)
result

# %%
all_memories = m.get_all(user_id="default_user")
all_memories

# %%
related_memories = m.search(query="What do you know about me?", user_id="default_user")
related_memories