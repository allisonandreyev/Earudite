"""Quick check: did my recording reach the shared MongoDB Atlas database?
<<<<<<< Updated upstream
Run:  CONNECTION_STRING="mongodb+srv://..." /opt/anaconda3/envs/earudite/bin/python3.11 check_recording.py
"""
import os
import pymongo

CONN = os.environ["CONNECTION_STRING"]
=======
Run:  /opt/anaconda3/envs/earudite/bin/python3.11 check_recording.py
"""
import pymongo

CONN = "mongodb+srv://dbPyServer:wGiP5iWRTvNwjapB@cluster0.qd4eu.mongodb.net/"
>>>>>>> Stashed changes
db = pymongo.MongoClient(CONN)["QuizzrDatabase"]

print("UnprocessedAudio docs:", db["UnprocessedAudio"].count_documents({}))
print("Audio docs:           ", db["Audio"].count_documents({}))
print("GridFS blobs:         ", db["AudioBlobs.files"].count_documents({}))
print("\n--- 5 most recent GridFS blobs ---")
for f in db["AudioBlobs.files"].find({}, {"filename": 1, "length": 1, "uploadDate": 1}).sort("uploadDate", -1).limit(5):
    print(f)
print("\n--- 5 most recent Audio docs ---")
for d in db["Audio"].find({}, {"userId": 1, "qb_id": 1, "recType": 1}).sort("_id", -1).limit(5):
    print(d)
