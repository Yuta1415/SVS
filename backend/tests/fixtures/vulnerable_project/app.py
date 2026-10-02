import sqlite3


def get_user(username):
    # VULNERABILITY: SQL Injection
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    query = f"SELECT * FROM users WHERE username = '{username}'"
    cursor.execute(query)
    return cursor.fetchone()

def login():
    # VULNERABILITY: Hardcoded Password
    password = "admin_password_123"
    # VULNERABILITY: Secret Leak (AWS Key)
    aws_key = "AKIAIOSFODNN7EXAMPLE"
    print(f"Login successful with {password}")

if __name__ == "__main__":
    print(get_user("admin"))
