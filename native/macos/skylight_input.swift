import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Background input addressed to one window of one process, through private
/// WindowServer (SkyLight) calls, so the user's pointer, front app, and key
/// window are left alone. Key focus is lent to the target window only for the
/// milliseconds an event batch takes, then handed back.
///
/// Approach adapted from arc-cua (MIT, github.com/shhivv/arc-cua,
/// backends/macos_background.py). Every symbol resolves at runtime; when a
/// required one is missing, `isAvailable` is false and callers fall back to
/// the existing delivery paths.
final class SkyLightInput {
	static let shared = SkyLightInput()

	private typealias PostToPid = @convention(c) (Int32, UnsafeMutableRawPointer) -> Void
	private typealias SetIntegerField = @convention(c) (UnsafeMutableRawPointer, UInt32, Int64) -> Void
	private typealias SetWindowLocation = @convention(c) (UnsafeMutableRawPointer, CGPoint) -> Void
	private typealias PostEventRecordTo = @convention(c) (UnsafeMutableRawPointer, UnsafeMutableRawPointer) -> Int32
	private typealias GetFrontProcess = @convention(c) (UnsafeMutableRawPointer) -> Int32
	private typealias GetProcessForPID = @convention(c) (Int32, UnsafeMutableRawPointer) -> Int32
	private typealias GetProcessPID = @convention(c) (UnsafeRawPointer, UnsafeMutablePointer<Int32>) -> Int32
	private typealias MainConnectionID = @convention(c) () -> UInt32
	private typealias GetWindowOwner = @convention(c) (UInt32, UInt32, UnsafeMutablePointer<UInt32>) -> Int32
	private typealias GetConnectionPSN = @convention(c) (UInt32, UnsafeMutableRawPointer) -> Int32
	private typealias SetAuthenticationMessage = @convention(c) (UnsafeMutableRawPointer, UnsafeMutableRawPointer) -> Void
	private typealias AuthMessageFactory = @convention(c) (AnyClass, Selector, UnsafeMutableRawPointer, Int32, UInt32) -> UnsafeMutableRawPointer?

	private let postToPid: PostToPid?
	private let setIntegerField: SetIntegerField?
	private let setWindowLocation: SetWindowLocation?
	private let postEventRecordTo: PostEventRecordTo?
	private let getFrontProcess: GetFrontProcess?
	private let getProcessForPID: GetProcessForPID?
	private let getProcessPID: GetProcessPID?
	private let mainConnectionID: MainConnectionID?
	private let getWindowOwner: GetWindowOwner?
	private let getConnectionPSN: GetConnectionPSN?
	private let setAuthenticationMessage: SetAuthenticationMessage?

	// CGEvent integer fields set on window-addressed mouse events.
	private static let fieldPhase: UInt32 = 0
	private static let fieldClickState: UInt32 = 1
	private static let fieldButton: UInt32 = 3
	private static let fieldSubtype: UInt32 = 7
	private static let fieldTargetPid: UInt32 = 40
	private static let fieldWindowIds: [UInt32] = [51, 91, 92]
	private static let fieldGroup: UInt32 = 58

	private init() {
		let paths: [String] = [
			"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
			"/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
		]
		var handles: [UnsafeMutableRawPointer] = []
		for path in paths {
			if let handle = dlopen(path, RTLD_NOW | RTLD_GLOBAL) { handles.append(handle) }
		}
		func symbol<T>(_ name: String, as _: T.Type) -> T? {
			for handle in handles {
				if let pointer = dlsym(handle, name) { return unsafeBitCast(pointer, to: T.self) }
			}
			if let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) { return unsafeBitCast(pointer, to: T.self) }
			return nil
		}
		postToPid = symbol("SLEventPostToPid", as: PostToPid.self)
		setIntegerField = symbol("SLEventSetIntegerValueField", as: SetIntegerField.self)
		setWindowLocation = symbol("CGEventSetWindowLocation", as: SetWindowLocation.self)
		postEventRecordTo = symbol("SLPSPostEventRecordTo", as: PostEventRecordTo.self)
		getFrontProcess = symbol("_SLPSGetFrontProcess", as: GetFrontProcess.self)
		getProcessForPID = symbol("GetProcessForPID", as: GetProcessForPID.self)
		getProcessPID = symbol("GetProcessPID", as: GetProcessPID.self)
		mainConnectionID = symbol("CGSMainConnectionID", as: MainConnectionID.self)
		getWindowOwner = symbol("SLSGetWindowOwner", as: GetWindowOwner.self)
		getConnectionPSN = symbol("SLSGetConnectionPSN", as: GetConnectionPSN.self)
		setAuthenticationMessage = symbol("SLEventSetAuthenticationMessage", as: SetAuthenticationMessage.self)
	}

	var isAvailable: Bool {
		postToPid != nil && setIntegerField != nil && setWindowLocation != nil && postEventRecordTo != nil && getFrontProcess != nil && getProcessForPID != nil
	}

	var missingSymbols: [String] {
		[
			("SLEventPostToPid", postToPid != nil),
			("SLEventSetIntegerValueField", setIntegerField != nil),
			("CGEventSetWindowLocation", setWindowLocation != nil),
			("SLPSPostEventRecordTo", postEventRecordTo != nil),
			("_SLPSGetFrontProcess", getFrontProcess != nil),
			("GetProcessForPID", getProcessForPID != nil),
		].filter { !$0.1 }.map(\.0)
	}

	// MARK: Focus without raise

	private typealias PSN = (UInt32, UInt32)

	private func frontProcess() -> PSN? {
		guard let getFrontProcess else { return nil }
		var psn: PSN = (0, 0)
		let status = withUnsafeMutableBytes(of: &psn) { getFrontProcess($0.baseAddress!) }
		return status == 0 ? psn : nil
	}

	private func pid(of psn: PSN) -> Int32? {
		guard let getProcessPID else { return nil }
		var copy = psn
		var pid: Int32 = 0
		let status = withUnsafeBytes(of: &copy) { getProcessPID($0.baseAddress!, &pid) }
		return status == 0 ? pid : nil
	}

	private func process(owning window: UInt32, pid: Int32) -> PSN? {
		var psn: PSN = (0, 0)
		if let mainConnectionID, let getWindowOwner, let getConnectionPSN {
			var owner: UInt32 = 0
			if getWindowOwner(mainConnectionID(), window, &owner) == 0, owner != 0,
				withUnsafeMutableBytes(of: &psn, { getConnectionPSN(owner, $0.baseAddress!) }) == 0
			{
				return psn
			}
		}
		guard let getProcessForPID else { return nil }
		return withUnsafeMutableBytes(of: &psn, { getProcessForPID(pid, $0.baseAddress!) }) == 0 ? psn : nil
	}

	private func send(focused: Bool, window: UInt32, to psn: PSN) -> Bool {
		guard let postEventRecordTo else { return false }
		var record = [UInt8](repeating: 0, count: 0xF8)
		record[0x04] = 0xF8
		record[0x08] = 0x0D
		withUnsafeBytes(of: window.littleEndian) { bytes in
			for (index, byte) in bytes.enumerated() { record[0x3C + index] = byte }
		}
		record[0x8A] = focused ? 0x01 : 0x02
		var target = psn
		return record.withUnsafeMutableBytes { recordBytes in
			withUnsafeMutableBytes(of: &target) { postEventRecordTo($0.baseAddress!, recordBytes.baseAddress!) }
		} == 0
	}

	/// In-app make-key records for one exact window (event kinds 0x01/0x02).
	/// A never-activated app drops synthesized input until its window is primed
	/// this way (documented by cua-driver, MIT, for LibreOffice and others).
	private func sendMakeKeyRecords(window: UInt32, to psn: PSN) -> Bool {
		guard let postEventRecordTo else { return false }
		var ok = true
		for kind: UInt8 in [0x01, 0x02] {
			var record = [UInt8](repeating: 0, count: 0xF8)
			record[0x04] = 0xF8
			record[0x08] = kind
			record[0x3A] = 0x10
			for index in 0x20..<0x30 { record[index] = 0xFF }
			withUnsafeBytes(of: window.littleEndian) { bytes in
				for (index, byte) in bytes.enumerated() { record[0x3C + index] = byte }
			}
			var target = psn
			ok = (record.withUnsafeMutableBytes { recordBytes in
				withUnsafeMutableBytes(of: &target) { postEventRecordTo($0.baseAddress!, recordBytes.baseAddress!) }
			} == 0) && ok
		}
		return ok
	}

	private struct Borrowed {
		let userPSN: PSN
		let userWindow: UInt32?
		let targetPSN: PSN
		let targetWindow: UInt32
	}

	private func samePSN(_ a: PSN, _ b: PSN) -> Bool { a.0 == b.0 && a.1 == b.1 }

	/// Makes `window` key inside its app while the user's app stays frontmost and
	/// nothing is raised, runs `body`, then hands key focus back.
	///
	/// Pointer input passes `defocusUser: false`: posting a defocus record to the
	/// user's app makes its key window resign key, and their typing is dropped
	/// until they click it again (observed by cua-driver). Keyboard input needs
	/// the exclusive key window, so it defocuses and restores.
	func withBorrowedFocus<T>(pid: Int32, window: UInt32, defocusUser: Bool = true, keyWindow: (Int32) -> UInt32?, _ body: () throws -> T) throws -> T {
		guard isAvailable, let user = frontProcess(), let target = process(owning: window, pid: pid) else {
			throw BridgeFailure(message: "Background key focus is unavailable for this window", code: "background_unavailable")
		}
		let distinct = defocusUser && !samePSN(user, target)
		let userWindow = distinct ? self.pid(of: user).flatMap(keyWindow) : nil
		if distinct { _ = send(focused: false, window: window, to: user) }
		guard send(focused: true, window: window, to: target) else {
			throw BridgeFailure(message: "The target window could not take background key focus", code: "background_unavailable")
		}
		usleep(20_000)
		_ = sendMakeKeyRecords(window: window, to: target)
		defer {
			if distinct {
				_ = send(focused: false, window: window, to: target)
				if let userWindow { _ = send(focused: true, window: userWindow, to: user) }
			}
		}
		usleep(40_000)
		return try body()
	}

	// MARK: Events

	private func pointer(_ event: CGEvent) -> UnsafeMutableRawPointer {
		Unmanaged.passUnretained(event).toOpaque()
	}

	/// Chromium-family apps accept background keys only with an authentication message.
	private func attachAuthentication(_ event: CGEvent, pid: Int32) {
		guard let setAuthenticationMessage,
			let cls = NSClassFromString("SLSEventAuthenticationMessage"),
			let method = class_getClassMethod(cls, NSSelectorFromString("messageWithEventRecord:pid:version:"))
		else { return }
		let implementation = unsafeBitCast(method_getImplementation(method), to: AuthMessageFactory.self)
		let eventPointer = pointer(event)
		// __CGEvent is {CFRuntimeBase, uint32_t, SLSEventRecord *}.
		for offset in [24, 32, 16] {
			guard let record = eventPointer.load(fromByteOffset: offset, as: UnsafeMutableRawPointer?.self) else { continue }
			autoreleasepool {
				if let message = implementation(cls, NSSelectorFromString("messageWithEventRecord:pid:version:"), record, pid, 0) {
					setAuthenticationMessage(eventPointer, message)
				}
			}
			return
		}
	}

	/// Posts a keyboard event to `pid` (focus must already be borrowed).
	func postKey(_ event: CGEvent, pid: Int32) {
		guard let postToPid else { return }
		attachAuthentication(event, pid: pid)
		postToPid(pid, pointer(event))
	}

	/// macOS 27+ reads the CGEventSetWindowLocation stamp of a pid-routed event as
	/// the window-local point (top-left origin); earlier releases derive it from a
	/// screen point. A screen stamp on 27 lands shifted by the window origin.
	static let windowLocationIsWindowLocal = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 27

	private func address(_ event: CGEvent, window: UInt32, point: CGPoint, windowOrigin: CGPoint) {
		guard let setIntegerField, let setWindowLocation else { return }
		let raw = pointer(event)
		for field in Self.fieldWindowIds { setIntegerField(raw, field, Int64(window)) }
		let offscreen = point.x < 0 && point.y < 0
		let stamp = Self.windowLocationIsWindowLocal && !offscreen ? CGPoint(x: point.x - windowOrigin.x, y: point.y - windowOrigin.y) : point
		setWindowLocation(raw, stamp)
	}

	private func mouseEvent(_ type: CGEventType, at point: CGPoint, button: CGMouseButton, pid: Int32, window: UInt32, windowOrigin: CGPoint, phase: Int64, clicks: Int64, group: Int64, flags: CGEventFlags = []) throws -> CGEvent {
		guard let setIntegerField,
			let event = CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: type, mouseCursorPosition: point, mouseButton: button)
		else { throw BridgeFailure(message: "Failed to create background mouse event", code: "input_failed") }
		event.flags = flags
		let raw = pointer(event)
		setIntegerField(raw, Self.fieldPhase, phase)
		setIntegerField(raw, Self.fieldClickState, clicks)
		setIntegerField(raw, Self.fieldButton, button == .right ? 1 : (button == .center ? 2 : 0))
		setIntegerField(raw, Self.fieldSubtype, 3)
		setIntegerField(raw, Self.fieldTargetPid, Int64(pid))
		setIntegerField(raw, Self.fieldGroup, group)
		address(event, window: window, point: point, windowOrigin: windowOrigin)
		return event
	}

	/// Clicks at a screen point inside `window`. The stream matches what Chromium
	/// accepts from a trusted source: a stamped move, an off-screen primer click
	/// for its user-activation gate, then the target clicks.
	func click(pid: Int32, window: UInt32, windowOrigin: CGPoint, at point: CGPoint, button: CGMouseButton, clickCount: Int, keyWindow: (Int32) -> UInt32?) throws {
		guard let postToPid else { throw BridgeFailure(message: "Background input is unavailable", code: "background_unavailable") }
		try withBorrowedFocus(pid: pid, window: window, defocusUser: false, keyWindow: keyWindow) {
			let group = Int64(DispatchTime.now().uptimeNanoseconds & 0x7FFF_FFFF)
			func emit(_ type: CGEventType, _ at: CGPoint, phase: Int64, clicks: Int64, sleepMicros: useconds_t, eventButton: CGMouseButton = button) throws {
				postToPid(pid, pointer(try mouseEvent(type, at: at, button: eventButton, pid: pid, window: window, windowOrigin: windowOrigin, phase: phase, clicks: clicks, group: group)))
				if sleepMicros > 0 { usleep(sleepMicros) }
			}
			try emit(.mouseMoved, point, phase: 2, clicks: 0, sleepMicros: 15_000, eventButton: .left)
			if button == .left {
				let offscreen = CGPoint(x: -1, y: -1)
				try emit(.leftMouseDown, offscreen, phase: 1, clicks: 1, sleepMicros: 1_000)
				try emit(.leftMouseUp, offscreen, phase: 2, clicks: 1, sleepMicros: 100_000)
			}
			let (down, up): (CGEventType, CGEventType) = button == .right ? (.rightMouseDown, .rightMouseUp) : (button == .center ? (.otherMouseDown, .otherMouseUp) : (.leftMouseDown, .leftMouseUp))
			let count = max(1, min(3, clickCount))
			for index in 1...count {
				try emit(down, point, phase: 3, clicks: Int64(index), sleepMicros: 1_000)
				try emit(up, point, phase: 3, clicks: Int64(index), sleepMicros: index < count ? 80_000 : 30_000)
			}
		}
	}

	func move(pid: Int32, window: UInt32, windowOrigin: CGPoint, to point: CGPoint) throws {
		guard let postToPid else { throw BridgeFailure(message: "Background input is unavailable", code: "background_unavailable") }
		let group = Int64(DispatchTime.now().uptimeNanoseconds & 0x7FFF_FFFF)
		postToPid(pid, pointer(try mouseEvent(.mouseMoved, at: point, button: .left, pid: pid, window: window, windowOrigin: windowOrigin, phase: 2, clicks: 0, group: group)))
	}

	func scroll(pid: Int32, window: UInt32, windowOrigin: CGPoint, at point: CGPoint, deltaX: Int, deltaY: Int) throws {
		guard let postToPid,
			let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(-deltaY), wheel2: Int32(deltaX), wheel3: 0)
		else { throw BridgeFailure(message: "Background scroll is unavailable", code: "background_unavailable") }
		event.location = point
		address(event, window: window, point: point, windowOrigin: windowOrigin)
		postToPid(pid, pointer(event))
	}
}
