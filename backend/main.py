import asyncio
import os
import sqlite3
from contextlib import closing
from typing import Any

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DATABASE_PATH = os.getenv("DATABASE_PATH", "magnitke.db")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
MINI_APP_URL = os.getenv("MINI_APP_URL", "")
OWNER_ID = int(os.getenv("OWNER_ID", "0"))

app = FastAPI(title="Магнитке Runner API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
router = Router()
bot = Bot(BOT_TOKEN) if BOT_TOKEN else None
dispatcher = Dispatcher()
dispatcher.include_router(router)

class UserPayload(BaseModel):
    user_id: int = Field(default=0, ge=0)
    username: str = Field(default="Игрок", max_length=64)

class ScorePayload(UserPayload):
    distance: int = Field(default=0, ge=0, le=10_000_000)
    mognetki: int = Field(default=0, ge=0, le=10_000_000)

class CharacterPayload(UserPayload):
    character_name: str = Field(default="gigachad", min_length=1, max_length=32)


def database() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with closing(database()) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT NOT NULL DEFAULT 'Игрок',
                max_distance INTEGER NOT NULL DEFAULT 0,
                total_mognetki INTEGER NOT NULL DEFAULT 0,
                character_name TEXT NOT NULL DEFAULT 'gigachad'
            )
        """)
        connection.commit()


def upsert_user(connection: sqlite3.Connection, payload: UserPayload) -> None:
    connection.execute("""
        INSERT INTO users (user_id, username)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET username = excluded.username
    """, (payload.user_id, payload.username or "Игрок"))


def user_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row) if row else {"user_id": 0, "username": "Игрок", "max_distance": 0, "total_mognetki": 0, "character_name": "gigachad"}


@app.on_event("startup")
async def startup() -> None:
    initialize_database()
    if bot:
        asyncio.create_task(dispatcher.start_polling(bot))


@app.on_event("shutdown")
async def shutdown() -> None:
    if bot:
        await bot.session.close()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/get_user")
def get_user(payload: UserPayload) -> dict[str, Any]:
    with closing(database()) as connection:
        upsert_user(connection, payload)
        connection.commit()
        row = connection.execute("SELECT * FROM users WHERE user_id = ?", (payload.user_id,)).fetchone()
    return user_dict(row)


@app.post("/api/save_score")
def save_score(payload: ScorePayload) -> dict[str, Any]:
    with closing(database()) as connection:
        upsert_user(connection, payload)
        connection.execute("""
            UPDATE users
            SET max_distance = MAX(max_distance, ?), total_mognetki = total_mognetki + ?
            WHERE user_id = ?
        """, (payload.distance, payload.mognetki, payload.user_id))
        connection.commit()
        row = connection.execute("SELECT * FROM users WHERE user_id = ?", (payload.user_id,)).fetchone()
    return user_dict(row)


@app.post("/api/buy_character")
def buy_character(payload: CharacterPayload) -> dict[str, Any]:
    with closing(database()) as connection:
        upsert_user(connection, payload)
        connection.execute("UPDATE users SET character_name = ? WHERE user_id = ?", (payload.character_name, payload.user_id))
        connection.commit()
        row = connection.execute("SELECT * FROM users WHERE user_id = ?", (payload.user_id,)).fetchone()
    return user_dict(row)


# ОБНОВЛЕННАЯ КОМАНДА С АВТОУДАЛЕНИЕМ КНОПКИ
@router.message(Command("game"))
async def game_command(message: Message) -> None:
    if not bot:
        return
        
    # Сразу удаляем саму команду /game от пользователя, чтобы не спамить в чате
    try:
        await message.delete()
    except Exception:
        pass
        
    if message.from_user and message.from_user.id != OWNER_ID:
        return
        
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Открыть Магнитке Runner 🎮", web_app=WebAppInfo(url=MINI_APP_URL))
    ]])
    
    # Отправляем кнопку запуска в чат
    bot_message = await message.answer(
        "Ночной забег начинается. Собери больше МОГнеток, чем вся группа.", 
        reply_markup=keyboard
    )
    
    # Фоновая задача: ждем 15 секунд и удаляем сообщение бота с кнопкой
    await asyncio.sleep(15)
    try:
        await bot_message.delete()
    except Exception:
        pass


@router.message(Command("stats"))
async def stats_command(message: Message) -> None:
    if not bot:
        return
    with closing(database()) as connection:
        distance_rows = connection.execute("SELECT username, max_distance FROM users ORDER BY max_distance DESC, user_id LIMIT 5").fetchall()
        mognetki_rows = connection.execute("SELECT username, total_mognetki FROM users ORDER BY total_mognetki DESC, user_id LIMIT 5").fetchall()
    distance_text = "\n".join(f"{index}. {row['username']} — {row['max_distance']} м" for index, row in enumerate(distance_rows, 1)) or "Пока пусто"
    mognetki_text = "\n".join(f"{index}. {row['username']} — {row['total_mognetki']}" for index, row in enumerate(mognetki_rows, 1)) or "Пока пусто"
    await message.answer(f"ТОП ПО ДИСТАНЦИИ\n{distance_text}\n\nТОП ПО МОГНЕТКАМ\n{mognetki_text}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
