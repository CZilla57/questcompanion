import Foundation

/// Parsing/formatting for the ISO-ish timestamp strings the API returns.
/// Timestamps are kept as `String` on the models (the server mixes plain dates
/// and full ISO-8601), and parsed on demand here.
enum DateUtils {
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let dateOnly: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func parse(_ string: String?) -> Date? {
        guard let string, !string.isEmpty else { return nil }
        return isoFractional.date(from: string)
            ?? iso.date(from: string)
            ?? dateOnly.date(from: string)
    }

    /// e.g. "2h ago", "in 3 days".
    static func relative(_ string: String?) -> String {
        guard let date = parse(string) else { return "" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    /// e.g. "Mon, Sep 8".
    static func mediumDay(_ string: String?) -> String {
        guard let date = parse(string) else { return "" }
        let f = DateFormatter()
        f.dateFormat = "EEE, MMM d"
        return f.string(from: date)
    }

    /// A friendly due-date label with relative emphasis for today/tomorrow.
    static func dueLabel(_ string: String?, time: String? = nil) -> String? {
        guard let date = parse(string) else { return nil }
        let cal = Calendar.current
        var label: String
        if cal.isDateInToday(date) { label = "Today" }
        else if cal.isDateInTomorrow(date) { label = "Tomorrow" }
        else if cal.isDateInYesterday(date) { label = "Yesterday" }
        else { label = mediumDay(string) }
        if let time, !time.isEmpty { label += " · \(time)" }
        return label
    }

    /// Combine a `yyyy-MM-dd` due date and an `HH:mm` (24-hour) due time into a
    /// concrete instant in the device's current time zone. Returns nil if either
    /// string is malformed.
    static func dueFireDate(date: String, time: String) -> Date? {
        let d = date.split(separator: "-"), t = time.split(separator: ":")
        guard d.count == 3, t.count == 2,
              let y = Int(d[0]), let mo = Int(d[1]), let day = Int(d[2]),
              let h = Int(t[0]), let mi = Int(t[1]) else { return nil }
        var c = DateComponents()
        c.year = y; c.month = mo; c.day = day; c.hour = h; c.minute = mi
        return Calendar.current.date(from: c)  // Calendar.current == local tz
    }
}
