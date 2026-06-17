import io
import os

import firebase_admin
import pyAesCrypt
import pymongo
import pymongo.database
import bson.json_util
from firebase_admin import credentials, storage


# Prototype for downloading the entire dataset.
AES_BUFFER_SIZE = 1024 * 64

def download_collection(db: pymongo.database.Database, collection_name: str, download_dir: str):
    path = os.path.join(download_dir, collection_name) + ".json"
    if os.path.exists(path):
        print(f"Collection '{collection_name}' already downloaded. Skipping")
        return
    print(f"Downloading collection '{collection_name}'...")
    coll = db.get_collection(collection_name)
    cursor = coll.find()
    docs = [doc for doc in cursor]
    with open(path, "w") as f:
        f.write(bson.json_util.dumps(docs))


def main():
    blob_root = os.environ.get("BLOB_ROOT")
    if not blob_root:
        raise ValueError("Environment variable 'BLOB_ROOT' not defined")

    db_name = os.environ.get("DATABASE")
    if not db_name:
        raise ValueError("Environment variable 'DATABASE' not defined")

    download_dir = os.environ.get("DOWNLOAD_DIR")
    if not download_dir:
        raise ValueError("Environment variable 'DOWNLOAD_DIR' not defined")

    secret_path = os.environ.get("SECRET_PATH")
    if not secret_path:
        raise ValueError("Environment variable 'SECRET_PATH' not defined")

    connection_string = os.environ.get("CONNECTION_STRING")
    if not connection_string:
        raise ValueError("Environment variable 'CONNECTION_STRING' not defined")

    c_type2ext = {
        "audio/x-wav": ".wav",
        "audio/wav": ".wav"
    }
    cred = credentials.Certificate(secret_path)
    mongodb_client = pymongo.MongoClient(connection_string)
    firebase_admin.initialize_app(cred, {
        "storageBucket": "earudite-5aa9e.firebasestorage.app"
    })
    bucket = storage.bucket()

    mongo_dir = os.path.join(download_dir, "mongo")
    os.makedirs(mongo_dir, exist_ok=True)

    db = mongodb_client.get_database(db_name)
    for coll_name in ["Audio", "RecordedQuestions", "LeaderboardArchive", "UnrecordedQuestions", "Games", "Users"]:
        download_collection(db, coll_name, mongo_dir)

    firebase_dir = os.path.join(download_dir, "firebase")
    os.makedirs(firebase_dir, exist_ok=True)

    for blob in bucket.list_blobs():
        if blob_root and not blob.name.startswith(blob_root):
            continue

        if blob.content_type not in c_type2ext:
            print(f"No extension associated with content type '{blob.content_type}'. Skipping")
            continue

        ext = c_type2ext[blob.content_type]
        # Accommodate for blob "paths"
        path = os.path.normpath(os.path.join(firebase_dir, blob.name)) + ext
        directory = os.path.dirname(path)
        os.makedirs(directory, exist_ok=True)

        # Attempt to decrypt the blob
        print(f"Downloading blob with name '{blob.name}'...")
        file_bytes = blob.download_as_bytes()
        fh_aes = io.BytesIO(file_bytes)
        final_bytesio = io.BytesIO()

        print("Attempting decryption...")

        try:
            print("Decryption successful")
            pyAesCrypt.decryptStream(fh_aes, final_bytesio, os.environ["DF_SERVER_AUDIO_PSWD"],
                                     AES_BUFFER_SIZE, len(fh_aes.getvalue()))
        except ValueError as e:
            print(f"Decryption failed: {e}. Proceeding without decryption")
            final_bytesio.write(file_bytes)

        final_bytesio.seek(0)  # Reset BytesIO to beginning

        if not os.path.exists(path):
            print("Saving result...")
            with open(path, "wb") as f:
                f.write(final_bytesio.read())
        else:
            print(f"Blob with name '{blob.name}' already downloaded. Skipping")


if __name__ == '__main__':
    main()
