class Logger {
    private _prefix: string;
    private _callingClass: string;

    constructor(prefix: string, callingClass: string) {
        this._prefix = prefix;
        this._callingClass = callingClass;
    }

    private _log(level: string, message: unknown) {
        log(`${this._prefix} [${level}] >> ${this._callingClass} :: ${message}`);
    }

    debug(message: string) {
        this._log('DEBUG', message);
    }

    info(message: string) {
        this._log('INFO', message);
    }

    warn(message: string) {
        this._log('WARNING', message);
    }

    error(message: string) {
        this._log('ERROR', message);
    }
}

export {Logger};
