import * as THREE from "three";

/**
 * Makes the robot follow a mouse and remain draggable on touch screens without
 * making the robot itself depend on DOM input.
 * Returns a cleanup function for component unmounting or scene disposal.
 */
export function attachVerityPointerControls(element, robot, {
  maxPitch = 0.18,
  maxYaw = 0.85,
  pitchSensitivity = 0.9,
  yawSensitivity = 1.55,
  followMouse = true,
  followMaxPitch = 0.12,
  followMaxYaw = 0.34,
  trackingElement = window,
  resetOnDoubleClick = true,
} = {}) {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startPitch = 0;
  let startYaw = 0;

  const handlePointerDown = (event) => {
    if (event.button !== 0 || event.pointerType === "mouse") return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startPitch = robot.dragRotationTarget.x;
    startYaw = robot.dragRotationTarget.y;
    element.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event) => {
    if (event.pointerId !== pointerId) return;
    const bounds = element.getBoundingClientRect();
    const width = Math.max(bounds.width, 1);
    const height = Math.max(bounds.height, 1);
    const yaw = THREE.MathUtils.clamp(
      startYaw + (event.clientX - startX) / width * yawSensitivity,
      -maxYaw,
      maxYaw,
    );
    const pitch = THREE.MathUtils.clamp(
      startPitch + (event.clientY - startY) / height * pitchSensitivity,
      -maxPitch,
      maxPitch,
    );
    robot.setDragRotation(pitch, yaw);
  };

  const handleMouseFollow = (event) => {
    if (!followMouse || event.pointerType !== "mouse" || pointerId !== null) return;
    const bounds = element.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const horizontalReach = Math.max(bounds.width * 0.92, 1);
    const verticalReach = Math.max(bounds.height * 1.45, 1);
    const normalizedX = THREE.MathUtils.clamp(
      (event.clientX - centerX) / horizontalReach,
      -1,
      1,
    );
    const normalizedY = THREE.MathUtils.clamp(
      (event.clientY - centerY) / verticalReach,
      -1,
      1,
    );
    robot.setDragRotation(
      normalizedY * followMaxPitch,
      normalizedX * followMaxYaw,
    );
  };

  const finishDrag = (event) => {
    if (event.pointerId !== pointerId) return;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    pointerId = null;
  };

  const resetRotation = () => robot.resetRotation();

  element.addEventListener("pointerdown", handlePointerDown);
  element.addEventListener("pointermove", handleDragMove);
  element.addEventListener("pointerup", finishDrag);
  element.addEventListener("pointercancel", finishDrag);
  trackingElement.addEventListener("pointermove", handleMouseFollow);
  window.addEventListener("blur", resetRotation);
  if (resetOnDoubleClick) element.addEventListener("dblclick", resetRotation);

  return () => {
    element.removeEventListener("pointerdown", handlePointerDown);
    element.removeEventListener("pointermove", handleDragMove);
    element.removeEventListener("pointerup", finishDrag);
    element.removeEventListener("pointercancel", finishDrag);
    trackingElement.removeEventListener("pointermove", handleMouseFollow);
    window.removeEventListener("blur", resetRotation);
    if (resetOnDoubleClick) element.removeEventListener("dblclick", resetRotation);
  };
}

/** Preserves the original drag-only helper for existing integrations. */
export function attachVerityDragControls(element, robot, options = {}) {
  return attachVerityPointerControls(element, robot, {
    ...options,
    followMouse: false,
  });
}
