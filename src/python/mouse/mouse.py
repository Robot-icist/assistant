import cv2
import mediapipe as mp
import pyautogui
import numpy as np
import math
import time
import dlib
from scipy.spatial import distance as dist

print("--- hand_mouse_control.py: Script Start ---")

# --- Configuration ---
SMOOTHING_FACTOR = 0.2
PREV_MOUSE_X, PREV_MOUSE_Y = 0, 0
# PINCH_THRESHOLD: Normalized distance between thumb and finger tips to trigger a click.
# A smaller value requires fingers to be closer (more "overlap").
# A larger value makes it more sensitive (more "touch").
# Original was 0.06, adjusted to 0.09 for a more "touch-like" feel.
PINCH_THRESHOLD = 0.3
CLICK_COOLDOWN = 0.3
MAX_HANDS = 1
DETECTION_CONFIDENCE = 0.7
TRACKING_CONFIDENCE = 0.5
ACTIVE_X_MIN, ACTIVE_X_MAX = 0.3, 0.7
ACTIVE_Y_MIN, ACTIVE_Y_MAX = 0.6, 0.8

# --- Configuration for Head Control ---
BLINK_THRESHOLD = 0.3  # Fine-tunable threshold for blink detection
BLINK_CONSEC_FRAMES = 2  # Number of consecutive frames to confirm a blink
BLINK_CLICK_COOLDOWN = 0.2  # Reduced cooldown time for faster eye-triggered clicks
HEAD_SENSITIVITY_X = 30  # Reduced sensitivity for head movement (X-axis)
HEAD_SENSITIVITY_Y = 20  # Reduced sensitivity for head movement (Y-axis)
HEAD_ACTIVE_X_MIN, HEAD_ACTIVE_X_MAX = 0.4, 0.6  # Adjusted active zone for head control (X-axis)
HEAD_ACTIVE_Y_MIN, HEAD_ACTIVE_Y_MAX = 0.4, 0.6  # Adjusted active zone for head q (Y-axis)

DOUBLE_CLICK_THRESHOLD = 0.3  # Time threshold for detqecting double clicks
DRAG_START_THRESHOLD = 0.2  # Distance threshold for starting drag-and-drop

# Landmark IDs
WRIST = 0
THUMB_TIP = 4
INDEX_FINGER_MCP = 5
INDEX_FINGER_TIP = 8
MIDDLE_FINGER_TIP = 12

# --- State Variables (for click timing and feedback) ---
last_left_click_time = 0
last_right_click_time = 0
left_click_feedback_time = 0
right_click_feedback_time = 0
FEEDBACK_DURATION = 0.5 # Duration for "CLICKED!" message

# --- State Variables for Blink Detection ---
blink_counter = 0
blinking = False
last_blink_time = time.time()

# --- State Variables for Drag-and-Drop ---
dragging = False
start_drag_x, start_drag_y = None, None

# --- Initialize MediaPipe Hands ---
hands_instance = None
try:
    print("[DEBUG] Attempting to initialize MediaPipe Hands...")
    mp_hands = mp.solutions.hands
    print("[DEBUG] mp.solutions.hands imported.")
    hands_instance = mp_hands.Hands(
        max_num_hands=MAX_HANDS,
        min_detection_confidence=DETECTION_CONFIDENCE,
        min_tracking_confidence=TRACKING_CONFIDENCE
    )
    print("[SUCCESS] MediaPipe Hands initialized successfully.")
    mp_drawing = mp.solutions.drawing_utils
    print("[DEBUG] mp.solutions.drawing_utils imported.")
    mp_drawing_styles = mp.solutions.drawing_styles
    print("[DEBUG] mp.solutions.drawing_styles imported.")
except Exception as e:
    print(f"[FATAL ERROR] Failed to initialize MediaPipe Hands: {e}")
    import traceback
    traceback.print_exc()
    exit()

# --- Mouse Control Setup ---
try:
    print("[DEBUG] Attempting to configure PyAutoGUI...")
    pyautogui.FAILSAFE = False
    print("[DEBUG] pyautogui.FAILSAFE set to False.")
    screen_width, screen_height = pyautogui.size()
    print(f"[SUCCESS] PyAutoGUI configured. Screen size: {screen_width}x{screen_height}")
except Exception as e:
    print(f"[FATAL ERROR] Failed to configure PyAutoGUI: {e}")
    import traceback
    traceback.print_exc()
    exit()

# --- Mode Switching ---
MODE_HAND_CONTROL = "hand_control"
MODE_HEAD_CONTROL = "head_control"
current_mode = MODE_HAND_CONTROL

# --- Initialize Dlib for Head Control ---
print("[INFO] Loading facial landmark predictor for head control...")
detector = dlib.get_frontal_face_detector()
try:
    predictor = dlib.shape_predictor("shape_predictor_68_face_landmarks.dat")
    print("[SUCCESS] Facial landmark predictor loaded.")
except RuntimeError as e:
    print(f"[ERROR] Could not load shape predictor: {e}")
    exit()

# --- Eye Aspect Ratio Helper Function ---
def eye_aspect_ratio(eye):
    A = dist.euclidean(eye[1], eye[5])
    B = dist.euclidean(eye[2], eye[4])
    C = dist.euclidean(eye[0], eye[3])
    ear = (A + B) / (2.0 * C)
    return ear

# --- Eye Landmark Indices ---
(lStart, lEnd) = (42, 48)
(rStart, rEnd) = (36, 42)

# --- Main Loop ---
print("[INFO] Attempting to start video stream for hand tracking...")
cap = None

try:
    camera_index = 0
    print(f"[DEBUG] Hand Tracking: Attempting to open camera with index: {camera_index}")
    cap = cv2.VideoCapture(camera_index)

    if cap is None or not cap.isOpened():
        print(f"[FATAL ERROR] Hand Tracking: Failed to open camera index {camera_index}!")
        exit()
    else:
        print(f"[SUCCESS] Hand Tracking: Camera index {camera_index} opened.")

    print("[DEBUG] Hand Tracking: Pausing for camera warm-up...")
    time.sleep(1.0)
    
    print("####################################################")
    print("###### [DEBUG] ATTEMPTING TO ENTER MAIN WHILE LOOP ######")
    print("####################################################")
    
    frame_count = 0

    while cap.isOpened():
        success, frame = cap.read()

        if not success:
            print(f"[WARNING] Main Loop: Failed to read frame (iteration {frame_count}). Skipping.")
            time.sleep(0.1) # Wait a bit before retrying
            frame_count += 1
            if frame_count > 100 and not success: # Heuristic: if 100 consecutive frames fail
                 print("[FATAL ERROR] Main Loop: Failed to read frames for too long. Exiting.")
                 break
            continue
        
        # Reset frame counter on success if you want to count consecutive failures
        # For now, frame_count is just a total processed frame indicator if successful
        frame_count += 1
        frame = cv2.flip(frame, 1)
        frame_height, frame_width, _ = frame.shape
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Initialize current_raw_screen_x and current_raw_screen_y to default values at the start of the loop.
        current_raw_screen_x, current_raw_screen_y = 0, 0

        # Initialize current_smoothed_mouse_x and current_smoothed_mouse_y to default values at the start of the loop.
        current_smoothed_mouse_x, current_smoothed_mouse_y = screen_width / 2, screen_height / 2

        # Initialize display_normalized_dist_thumb_index and display_normalized_dist_thumb_middle to default values at the start of the loop.
        display_normalized_dist_thumb_index, display_normalized_dist_thumb_middle = 1.0, 1.0

        # Initialize display_is_left_pinching and display_is_right_pinching to default values at the start of the loop.
        display_is_left_pinching, display_is_right_pinching = False, False

        # --- Ensuring that hand mode and head mode are mutually exclusive.
        if current_mode == MODE_HAND_CONTROL:
            results = hands_instance.process(rgb_frame)
            if results.multi_hand_landmarks:
                mouse_control_active = True
                # Process only the first detected hand
                for hand_idx, hand_landmarks in enumerate(results.multi_hand_landmarks):
                    mp_drawing.draw_landmarks(
                        frame, hand_landmarks, mp_hands.HAND_CONNECTIONS,
                        mp_drawing_styles.get_default_hand_landmarks_style(),
                        mp_drawing_styles.get_default_hand_connections_style()
                    )

                    landmarks = hand_landmarks.landmark
                    index_tip = landmarks[INDEX_FINGER_TIP]
                    thumb_tip = landmarks[THUMB_TIP]
                    middle_tip = landmarks[MIDDLE_FINGER_TIP]
                    wrist_pt = landmarks[WRIST]
                    index_mcp_pt = landmarks[INDEX_FINGER_MCP]

                    index_x_px = int(index_tip.x * frame_width)
                    index_y_px = int(index_tip.y * frame_height)
                    thumb_x_px = int(thumb_tip.x * frame_width)
                    thumb_y_px = int(thumb_tip.y * frame_height)
                    middle_x_px = int(middle_tip.x * frame_width)
                    middle_y_px = int(middle_tip.y * frame_height)

                    current_raw_screen_x = np.interp(index_tip.x, [ACTIVE_X_MIN, ACTIVE_X_MAX], [0, screen_width])
                    current_raw_screen_y = np.interp(index_tip.y, [ACTIVE_Y_MIN, ACTIVE_Y_MAX], [0, screen_height])
                    current_raw_screen_x = max(0, min(current_raw_screen_x, screen_width - 1))
                    current_raw_screen_y = max(0, min(current_raw_screen_y, screen_height - 1))

                    if PREV_MOUSE_X == 0 and PREV_MOUSE_Y == 0 : # Initialize if first time
                        PREV_MOUSE_X, PREV_MOUSE_Y = current_raw_screen_x, current_raw_screen_y

                    current_smoothed_mouse_x = PREV_MOUSE_X * (1 - SMOOTHING_FACTOR) + current_raw_screen_x * SMOOTHING_FACTOR
                    current_smoothed_mouse_y = PREV_MOUSE_Y * (1 - SMOOTHING_FACTOR) + current_raw_screen_y * SMOOTHING_FACTOR

                    pyautogui.moveTo(int(current_smoothed_mouse_x), int(current_smoothed_mouse_y), duration=0)
                    PREV_MOUSE_X, PREV_MOUSE_Y = current_smoothed_mouse_x, current_smoothed_mouse_y
                    cv2.circle(frame, (index_x_px, index_y_px), 10, (0, 255, 255), -1) # Cursor position on hand

                    hand_size_proxy = math.hypot((wrist_pt.x - index_mcp_pt.x) * frame_width, (wrist_pt.y - index_mcp_pt.y) * frame_height)
                    if hand_size_proxy < 1: hand_size_proxy = 1 # Avoid division by zero or very small numbers

                    dist_thumb_index = math.hypot(thumb_x_px - index_x_px, thumb_y_px - index_y_px)
                    display_normalized_dist_thumb_index = dist_thumb_index / hand_size_proxy
                    dist_thumb_middle = math.hypot(thumb_x_px - middle_x_px, thumb_y_px - middle_y_px)
                    display_normalized_dist_thumb_middle = dist_thumb_middle / hand_size_proxy

                    current_time = time.time()

                    if display_normalized_dist_thumb_index < PINCH_THRESHOLD:
                        display_is_left_pinching = True
                        cv2.line(frame, (thumb_x_px, thumb_y_px), (index_x_px, index_y_px), (0, 255, 0), 3) # Green line for left pinch
                        if (current_time - last_left_click_time > CLICK_COOLDOWN) and \
                           (current_time - right_click_feedback_time > FEEDBACK_DURATION): # Avoid clicking if other click feedback is active
                            # --- Double Click Logic ---
                            current_time = time.time()
                            if current_time - last_left_click_time < DOUBLE_CLICK_THRESHOLD:
                                pyautogui.doubleClick(button='left')
                                print("[ACTION] Double Left Click triggered.")
                            else:
                                pyautogui.click(button='left')
                                print("[ACTION] Single Left Click triggered.")
                            last_left_click_time = current_time
                            left_click_feedback_time = current_time

                    if display_normalized_dist_thumb_middle < PINCH_THRESHOLD:
                        display_is_right_pinching = True
                        cv2.line(frame, (thumb_x_px, thumb_y_px), (middle_x_px, middle_y_px), (255, 0, 0), 3) # Red line for right pinch
                        if (current_time - last_right_click_time > CLICK_COOLDOWN) and \
                           (current_time - left_click_feedback_time > FEEDBACK_DURATION): # Avoid clicking if other click feedback is active
                            pyautogui.click(button='right')
                            last_right_click_time = current_time
                            right_click_feedback_time = current_time
                    break # Process only one hand

        elif current_mode == MODE_HEAD_CONTROL:
            faces = detector(gray, 0)
            for face_rect in faces:
                shape = predictor(gray, face_rect)
                landmarks_np = np.array([(shape.part(i).x, shape.part(i).y) for i in range(68)])

                # Nose tip landmark (index 30)
                nose_tip = landmarks_np[30]
                nose_x, nose_y = nose_tip

                current_raw_screen_x = np.interp(nose_x, [HEAD_ACTIVE_X_MIN * frame_width, HEAD_ACTIVE_X_MAX * frame_width], [0, screen_width])
                current_raw_screen_y = np.interp(nose_y, [HEAD_ACTIVE_Y_MIN * frame_height, HEAD_ACTIVE_Y_MAX * frame_height], [0, screen_height])

                current_smoothed_mouse_x = PREV_MOUSE_X * (1 - SMOOTHING_FACTOR) + current_raw_screen_x * SMOOTHING_FACTOR
                current_smoothed_mouse_y = PREV_MOUSE_Y * (1 - SMOOTHING_FACTOR) + current_raw_screen_y * SMOOTHING_FACTOR

                pyautogui.moveTo(int(current_smoothed_mouse_x), int(current_smoothed_mouse_y), duration=0)
                PREV_MOUSE_X, PREV_MOUSE_Y = current_smoothed_mouse_x, current_smoothed_mouse_y

                cv2.circle(frame, (nose_x, nose_y), 5, (0, 255, 0), -1)  # Visualize nose tip

                # Blink detection for left and right clicks
                left_eye = landmarks_np[lStart:lEnd]
                right_eye = landmarks_np[rStart:rEnd]
                left_ear = eye_aspect_ratio(left_eye)
                right_ear = eye_aspect_ratio(right_eye)

                print(f"[DEBUG] Left EAR: {left_ear:.2f}, Right EAR: {right_ear:.2f}")

                if left_ear < BLINK_THRESHOLD and right_ear < BLINK_THRESHOLD:
                    blink_counter += 1
                    current_time = time.time()
                    if blink_counter == 1 and current_time - last_blink_time > BLINK_CLICK_COOLDOWN:
                        pyautogui.click(button='left')
                        print("[ACTION] Left Click triggered by single blink.")
                        last_blink_time = current_time
                    elif blink_counter == 2 and current_time - last_blink_time > BLINK_CLICK_COOLDOWN:
                        pyautogui.click(button='right')
                        print("[ACTION] Right Click triggered by double blink.")
                        blink_counter = 0
                        last_blink_time = current_time
                else:
                    blink_counter = 0

                # Ensure start_drag_x and start_drag_y are initialized properly
                if start_drag_x is None or start_drag_y is None:
                    start_drag_x, start_drag_y = current_smoothed_mouse_x, current_smoothed_mouse_y

                # Drag-and-Drop logic
                if dragging:
                    pyautogui.dragTo(int(current_smoothed_mouse_x), int(current_smoothed_mouse_y), duration=0)
                elif abs(current_smoothed_mouse_x - start_drag_x) > DRAG_START_THRESHOLD * screen_width or abs(current_smoothed_mouse_y - start_drag_y) > DRAG_START_THRESHOLD * screen_height:
                    dragging = True
                    pyautogui.mouseDown()
                    print("[ACTION] Drag started.")

                if not dragging:
                    start_drag_x, start_drag_y = current_smoothed_mouse_x, current_smoothed_mouse_y

        # --- Display Debug Info & Feedback ---
        y_offset = 20
        info_color = (200, 200, 100) 
        cv2.putText(frame, f"Screen Target (Raw): {int(current_raw_screen_x)}, {int(current_raw_screen_y)}", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, info_color, 1)
        y_offset += 20
        cv2.putText(frame, f"Mouse (Smooth): {int(current_smoothed_mouse_x)}, {int(current_smoothed_mouse_y)}", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, info_color, 1)
        y_offset += 25
        
        # Use display-specific variables for pinch status and distances
        cv2.putText(frame, f"T-I Dist: {display_normalized_dist_thumb_index:.3f}", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0) if display_is_left_pinching else info_color, 1)
        y_offset += 20
        cv2.putText(frame, f"T-M Dist: {display_normalized_dist_thumb_middle:.3f}", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,0,0) if display_is_right_pinching else info_color, 1)
        y_offset += 25
        
        cv2.putText(frame, f"Pinch Thresh: {PINCH_THRESHOLD:.3f}", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, info_color, 1)
        y_offset += 20
        cv2.putText(frame, f"Smooth Factor: {SMOOTHING_FACTOR:.2f}", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, info_color, 1)
        y_offset += 25

        current_time_for_feedback = time.time()
        if current_time_for_feedback - left_click_feedback_time < FEEDBACK_DURATION:
            cv2.putText(frame, "LEFT CLICKED!", (frame_width // 2 - 70, frame_height - 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        if current_time_for_feedback - right_click_feedback_time < FEEDBACK_DURATION:
            cv2.putText(frame, "RIGHT CLICKED!", (frame_width // 2 - 80, frame_height - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)
        
        if display_is_left_pinching and not (current_time_for_feedback - left_click_feedback_time < FEEDBACK_DURATION) :
            cv2.putText(frame, "L-Pinch Ready", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,180,0), 1)
        y_offset += 20 # Ensure y_offset increments even if L-Pinch Ready not shown
        if display_is_right_pinching and not (current_time_for_feedback - right_click_feedback_time < FEEDBACK_DURATION):
            cv2.putText(frame, "R-Pinch Ready", (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180,0,0), 1)

        cv2.putText(frame, f"Mode: {current_mode}", (10, frame_height - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 1)

        # --- Display Active Zone ---
        if current_mode == MODE_HAND_CONTROL:
            cv2.rectangle(frame, (int(ACTIVE_X_MIN * frame_width), int(ACTIVE_Y_MIN * frame_height)),
                          (int(ACTIVE_X_MAX * frame_width), int(ACTIVE_Y_MAX * frame_height)), (255, 255, 0), 2)
        elif current_mode == MODE_HEAD_CONTROL:
            cv2.rectangle(frame, (int(HEAD_ACTIVE_X_MIN * frame_width), int(HEAD_ACTIVE_Y_MIN * frame_height)),
                          (int(HEAD_ACTIVE_X_MAX * frame_width), int(HEAD_ACTIVE_Y_MAX * frame_height)), (255, 255, 0), 2)

        # --- Double Click Feature for Head Mode ---
        if current_mode == MODE_HEAD_CONTROL:
            current_time = time.time()
            if left_ear < BLINK_THRESHOLD and current_time - last_blink_time < DOUBLE_CLICK_THRESHOLD:
                pyautogui.doubleClick(button='left')
                print("[ACTION] Double Left Click triggered by blink.")
                last_blink_time = current_time
            elif right_ear < BLINK_THRESHOLD and current_time - last_blink_time < DOUBLE_CLICK_THRESHOLD:
                pyautogui.doubleClick(button='right')
                print("[ACTION] Double Right Click triggered by blink.")
                last_blink_time = current_time

        cv2.imshow("Hand Mouse Control - Debug ('q' to quit)", frame)
        
        key = cv2.waitKey(5) & 0xFF
        if key == ord('q'):
            print("[INFO] 'q' key pressed. Exiting loop.")
            break
        elif key == ord('m'):
            current_mode = MODE_HEAD_CONTROL if current_mode == MODE_HAND_CONTROL else MODE_HAND_CONTROL
            print(f"[INFO] Mode switched to: {current_mode}")

        # Add a flag to track if calibration has been done
        if 'head_calibrated' not in globals():
            global head_calibrated
            head_calibrated = False

        # Calibrate active zone for head mode only when mode is activated for the first time or when pressing 'r'
        if current_mode == MODE_HEAD_CONTROL and not head_calibrated:
            faces = detector(gray, 0)
            if faces:
                face_rect = faces[0]  # Use the first detected face
                shape = predictor(gray, face_rect)
                landmarks_np = np.array([(shape.part(i).x, shape.part(i).y) for i in range(68)])

                # Nose tip landmark (index 30)
                nose_tip = landmarks_np[30]
                nose_x, nose_y = nose_tip

                HEAD_ACTIVE_X_MIN = max(0, (nose_x - HEAD_SENSITIVITY_X) / frame_width)
                HEAD_ACTIVE_X_MAX = min(1, (nose_x + HEAD_SENSITIVITY_X) / frame_width)
                HEAD_ACTIVE_Y_MIN = max(0, (nose_y - HEAD_SENSITIVITY_Y) / frame_height)
                HEAD_ACTIVE_Y_MAX = min(1, (nose_y + HEAD_SENSITIVITY_Y) / frame_height)

                head_calibrated = True
                print(f"[INFO] Head active zone calibrated: X({HEAD_ACTIVE_X_MIN:.2f}, {HEAD_ACTIVE_X_MAX:.2f}), Y({HEAD_ACTIVE_Y_MIN:.2f}, {HEAD_ACTIVE_Y_MAX:.2f})")

        # Allow recalibration when pressing 'r'
        if key == ord('r'):
            head_calibrated = False
            print("[INFO] Recalibration triggered.")

except KeyboardInterrupt:
    print("[INFO] Program interrupted by user (KeyboardInterrupt).")
except Exception as e:
    print(f"[UNEXPECTED ERROR] An unexpected error occurred: {e}")
    import traceback
    traceback.print_exc()
finally:
    print("[INFO] Cleaning up resources...")
    if cap is not None and cap.isOpened():
        print("[DEBUG] Releasing video capture object.")
        cap.release()
    if hands_instance is not None:
         print("[DEBUG] Closing MediaPipe Hands instance.")
         hands_instance.close()
    print("[DEBUG] Destroying all OpenCV windows.")
    cv2.destroyAllWindows()
    print("--- hand_mouse_control.py: Script End ---")