from dotenv import load_dotenv
import os
from anthropic import Anthropic

# Async (better for FastAPI)
# from anthropic import AsyncAnthropic
# client = AsyncAnthropic(api_key="sk-ant-...")

load_dotenv()
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

client = Anthropic(api_key=ANTHROPIC_API_KEY)


# Store conversation history — one list per active conversation
# conversation_history = []

def respond(user_message: str, history: list, system_prompt: str) -> str:
    # switch to claude-sonnet-4-5-20250929 for demo
    # Pass the full history to Claude every time
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150,
        system=system_prompt,  # system prompt stays separate
        messages=history  # full history, not just the latest message
    )

    return response.content[0].text

# Append Claude's response to history too
"""
history.append({
    "role": "assistant",
    "content": assistant_message
})

return assistant_message
"""

