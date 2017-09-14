import { MinutesSchema } from '/imports/collections/minutes.schema';
import { MeetingSeriesSchema } from '/imports/collections/meetingseries.schema';
import { TopicSchema } from '/imports/collections/topic.schema';
import {MinutesFinder} from '../../imports/services/minutesFinder';

// add "createdAt" and "updatedAt" field for topics
// --> updates all existing topics in all minutes and the topics collection!
export class MigrateV17 {

    static up() {
        const minutesHandler = new MinutesHandler();
        const minutesIterator = new MinutesIterator(minutesHandler);
        minutesIterator.iterate();
    }

    static down() {
        const transformTopic = topic => {
            delete topic.createdAt;
            delete topic.updatedAt;
            topic.infoItems = topic.infoItems.map(item => {
                delete item.createdAt;
                delete item.updatedAt;
                item.details = item.details.map(detail => {
                    delete detail.createdAt;
                    delete detail.updatedAt;
                    return detail;
                });
                return item;
            });
            return topic;
        };

        TopicSchema.find().forEach(topic => {
            topic = transformTopic(topic);
            TopicSchema.getCollection().update(topic._id, { $set: topic });
        });

        MinutesSchema.find().forEach(minutes => {
            minutes.topics = minutes.topics.map(transformTopic);
            updateTopicFieldOfMinutes(minutes);
        });
    }

}

class MinutesIterator {

    constructor(minutesHandler) {
        this.minutesHandler = minutesHandler;
    }

    iterate() {
        let allSeries = MeetingSeriesSchema.find();
        allSeries.forEach(series => {
            this._iterateOverMinutesOfSeries(series);
            this.minutesHandler.finishedSeries();
        });
    }

    _iterateOverMinutesOfSeries(series) {
        let minutes = MinutesFinder.firstMinutesOfMeetingSeries(series);
        while (minutes) {
            this.minutesHandler.nextMinutes(minutes);
            minutes = MinutesFinder.nextMinutes(minutes);
        }
    }

}

class MinutesHandler {

    constructor() {
        this.currentMinutes = null;
        this.finalizedTopicsDictionary = {};
        this.finalizedItemsDictionary = {};
        this.finalizedItemDetailsDictionary = {};
        this.realisticCreatedAtDate = null;
    }

    finishedSeries() {
        this._updateTopicsOfMeetingSeries();
        this.finalizedTopicsDictionary = {};
    }

    _updateTopicsOfMeetingSeries() {
        Object.keys(this.finalizedTopicsDictionary).forEach(key => {
            const topic = this.finalizedTopicsDictionary[key];
            TopicSchema.getCollection().update(
                topic._id,
                { $set: { updatedAt: topic.updatedAt, createdAt: topic.createdAt, infoItems: topic.infoItems } }
            );
        });
    }

    nextMinutes(minutes) {
        this.currentMinutes = minutes;
        this.realisticCreatedAtDate = this._calcRealisticCreatedAtDate();
        minutes.topics = minutes.topics.map(topic => {
            topic.infoItems = topic.infoItems.map(item => this._handleInfoItem(item));
            return this._handleTopic(topic);
        });
        updateTopicFieldOfMinutes(minutes);
    }

    _calcRealisticCreatedAtDate() {
        return this.currentMinutes.createdAt;
    }

    _handleInfoItem(item) {
        item.details = item.details.map(detail => {
            return this._handleElement(detail, this.finalizedItemDetailsDictionary);
        });
        return this._handleElement(item, this.finalizedItemsDictionary);
    }

    _handleTopic(topic) {
        return this._handleElement(topic, this.finalizedTopicsDictionary);
    }

    _handleElement(element, dictionary) {
        if (MinutesHandler._isKnownElement(element._id, dictionary)) {
            element.createdAt = dictionary[element._id].createdAt;
            element.updatedAt = dictionary[element._id].updatedAt;
        } else {
            element.createdAt = this.realisticCreatedAtDate;
            element.updatedAt = this.realisticCreatedAtDate;
        }
        if (this.currentMinutes.isFinalized) {
            dictionary[element._id] = element;
        }
        return element;
    }

    static _isKnownElement(id, dictionary) {
        return !!dictionary[id];
    }

}

function updateTopicFieldOfMinutes(minutes) {
    // We getCollection() here to skip .clean & .validate to allow empty string values
    MinutesSchema.getCollection().update(
        minutes._id, {
            $set: {
                'topics': minutes.topics,
            }
        });
}