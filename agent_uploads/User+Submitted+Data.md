**User Submitted Data **

**Overview **

Through the feedback system in the myQ app, users have the ability to submit videos and feedback to us for improvement of our AI features. 



**Submission Bucket **

The data collected during a submission is stored within our Production AWS account in the following S3 bucket: 

s3://ml-training-data-vision/us-prod/submitted/video/ 



├ /video 

| ├ /2025 

| | ├ /1 

| | | ├ \[.mp4 videos\] 

| | | ├ \[.json feedback/metadata\] 

| | | ├ \[.json.gz compressed object detections\] 

| | | ├ \[.jpg thumbnails\] 

| | ├ ... 

| | ├ /12 

| ├ ... 

| ├ /2021 

We can access this data with keys from our AI-Sandbox account through the AWS CLI: 

\# pull all data from October 2025 

aws s3 sync s3://ml-training-data-vision/us-prod/submitted/video/2025/10 

\{destination\} 



\# pull all data from July 2025 for Doorbell Cameras only aws s3 sync s3://ml-training-data-vision/us-prod/submitted/video/2025/7 

\{destination\} --exclude "\*" --include "\*DoorbellCam\*" 

**File Contents **

**Videos **

Videos of the full event, stitched from the clip chunks that are uploaded to the cloud by our cameras. 

The filenames of these videos will match the prefix appended to all related documents in the bucket. 

• generally 10\+ seconds 

• mp4 format 

• ~20 fps 

• varied resolution and FoV \(depends on recording camera\) **Object Detections and Event Data** Files that contain “OnDevice” in the filename are the frame-wise detections from the object detector. 

The object detector on-device receives these at 10 fps, but these detections are subsampled at 3fps. 

\{ 

"eventId": "100542121416", 

"seqNum": 1, 

"seqOffsetTimeSec": 0.0, 

"alg": "OnDevice.SmartGarageLCCam2", 

"width": 2560, 

"height": 1440, 

"durationSec": 13.572, 

"frames": \[ 

\{ 

"num": 0, 

"timeSec": 0.0, 

"objects": \[ 

\{ 

"id": "0", 

"type": "person", 

"conf": 0.959, 

"life": 1, 

"tags": \{ 

"personId": "227046" 

\}, 

"x": 1963.0, 

"y": 240.0, 

"w": 288.0, 

"h": 832.0 

\} 

\] 

\}, 

... 

\}, 

"tracks": \{ 

"0": \{ 

"type": "person", 

"startSec": 0.0, 

"endSec": 13.572, 

"centerStart": \{ 

"x": 2107, 

"y": 656 

\}, 

"centerEnd": \{ 

"x": 1423, 

"y": 633 

\}, 

"avgSpeed": 97.5261, 

"maxSpeed": 97.5261, 

"totalDistance": 1323.6239 

\}, 

... 

\} 

\} 

Files that contain “eventDTO” are metadata collected about the video event and event processing state: 

\{ 

"id": "100542121416", 

"dttm": "2025-10-24T18:04:20-05:00", 

"type": "VIDEO", 

"srcType": "cam", 

"srcId": "13175345", 

"srcEventId": "1761347060", 

"duration": 20.299, 

"viewed": true, 

"favorite": false, 

"sharedPublic": true, 

"shareCode": "BtPr53Wf", 

"eventLife": 30, 

"status": "FINALIZED", 

"userId": "5093848", 

"values": \{ 

"face:0": "Ben Hunt", 

"peopleCount": 1, 

"afbDttm": "2025-10-27T17:35:51.765Z", 

"movingVehicleCount": 1, 

"afbConsent": "\{\\"consent\\":\\"Standard-V2\\"\}", 

"motionDetected": "true", 

"faceId:0": "227046", 

"faceMyQId:0": "238b73a2-4900-4fed-a159-5d1f2bac1083", 

"faceMyQAUId:0": "238b73a2-4900-4fed-a159-5d1f2bac1083", 

"recordReason": "motion" 

\}, 

"media": \{ 

"thumbnail": \{ 

"num": 1, 

"variants": \[ 

"256", 

"fr" 

\] 

\}, 

"videoCdn": \{ 

"num": 2 

\}, 

... 

\} 

\} 

**Feedback Files **

The user gives us information about what category of detection their submission is related to and feedback around TP, FP, etc. 

These files contain “feedback” in the filename. 

\{ 

"id": "wnC9JpoB1aytxV7sm\_jZ", 

"dttm": "2025-10-27T17:35:51\+00:00", 

"eventId": "100542121416", 

"sourceType": "cam", 

"srcId": "13175345", 

"userId": "5093848", 

"feedbackDelay": 239491.7656, 

"eventType": "VIDEO", 

"camModel": "SmartGarageLCCam2", 

"partnerId": "myQ", 

"consent": "\{\\"consent\\":\\"Standard-V2\\"\}", 

"comments": "It flagged a face and there was face with id: 227046", 

"category": "FDFR", 

"code": "TP", 

"eventDurationSec": 20.26, 

"truth": "227046", 

"processed": true 

\} 

**Camera Types **

The following lists the camera family types and the strings that can be used to filter user submissions for data specifically from these cameras. 

**Camera Family **

**Camera String **

**Notes **

Smart Garage Cameras 

SmartGarageCam “SGC” 

Garage Door Opener Cameras GDOCamera Cameras embedded inside GDO’s 

Smart Indoor Cameras 

SmartIndoor\*Cam 

Outdoor Powered Cameras 

OutdoorCam 



Outdoor Battery Cameras 

OutdoorBatCam 



Video Keypads 

VideoKeypadCam “VKP” 

Doorbell Cameras 

DoorbellCam 



Smart Lock Cameras 

SmartLockCam 

“BLC” \(Big League Chew\) - project name 




# Document Outline

+ User Submitted Data 
+ Overview  
	+ Submission Bucket 
	+ File Contents  
		+ Videos 
		+ Object Detections and Event Data 
		+ Feedback Files 

	+ Camera Types



