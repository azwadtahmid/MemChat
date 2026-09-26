import ollama
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
            "host": "localhost",
            "port": 6333,
        },
    },
}

memory = Memory.from_config(config)


def chat_with_memories(message: str, user_id: str = "default_user") -> str:
    relevant_memories = memory.search(
        query=message, filters={"user_id": user_id}, limit=3
    )
    memories_str = "\n".join(
        f"- {entry['memory']}" for entry in relevant_memories["results"]
    )
    if memories_str:
        print(f"[memories]\n{memories_str}")

    system_prompt = (
        "You are a helpful AI. Answer the question based on query and memories.\n"
        f"User Memories:\n{memories_str}"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": message},
    ]

    response = ollama.chat(model="llama3.2:3b", messages=messages)
    assistant_response = response["message"]["content"]

    messages.append({"role": "assistant", "content": assistant_response})
    memory.add(messages, user_id=user_id, metadata={"source": "demo"})

    return assistant_response


def main():
    print("Chat with AI (type 'exit' to quit)")
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() == "exit":
            print("Goodbye!")
            break
        print(f"AI: {chat_with_memories(user_input)}")


if __name__ == "__main__":
    main()