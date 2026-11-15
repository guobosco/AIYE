package com.example.aiye

import com.example.aiye.util.BookingTimeRangesCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BookingTimeRangesCodecTest {
    @Test
    fun midnightEndDoesNotFallBackToAllDay() {
        val actual = BookingTimeRangesCodec.availableStartMinutesForDay(
            """[{"start":"18:00","end":"24:00"}]"""
        )
        assertEquals((1080..1410 step 30).toList(), actual)
        assertNull(BookingTimeRangesCodec.parseMinutes("24:00"))
    }

    @Test
    fun disjointRangesRetainExclusiveEnds() {
        val actual = BookingTimeRangesCodec.availableStartMinutesForDay(
            """[{"start":"09:00","end":"10:00"},{"start":"23:00","end":"24:00"}]"""
        )
        assertEquals(listOf(540, 570, 1380, 1410), actual)
    }

    @Test
    fun emptyRangesRemainAllDay() {
        assertEquals((0..1410 step 30).toList(), BookingTimeRangesCodec.availableStartMinutesForDay("[]"))
    }
}
