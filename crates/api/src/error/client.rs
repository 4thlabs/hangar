//! The code of an error as the client of the contract reads it back from the server's problem.

use serde_json::{Map, Value};

use super::ErrorCode;

impl ErrorCode {
    /// The members of a problem that RFC 9457 names, which are no param.
    const PROBLEM_MEMBERS: [&str; 5] = ["type", "title", "status", "detail", "instance"];

    /// The code and the params of `error`, a problem the server answered, read from its `type` and its extension
    /// members; `None` for any other error, as one quoll answers itself or a call that got no answer.
    ///
    /// ```
    /// use hangar_api::ErrorCode;
    ///
    /// let unknown = ErrorCode::UnknownApp { app: "alpha".to_owned() };
    /// let answered = quoll::Error::from(unknown.clone()).into_answered();
    ///
    /// assert_eq!(ErrorCode::read(&answered), Some(unknown));
    /// assert_eq!(ErrorCode::read(&quoll::Error::not_found("no route").into_answered()), None);
    /// ```
    pub fn read(error: &quoll::Error) -> Option<Self> {
        let code = error
            .detail()?
            .kind()
            .strip_prefix(Self::PROBLEM_TYPE_PREFIX)?;
        let mut params: Map<String, Value> = error.body_as()?;

        for member in Self::PROBLEM_MEMBERS {
            params.remove(member);
        }

        let without_params = Map::from_iter([("code".to_owned(), Value::from(code))]);
        let mut with_params = without_params.clone();

        with_params.insert("params".to_owned(), Value::Object(params));

        // A code that has params reads them and ignores a member of no param; one that has none takes no `params` at
        // all, whatever members its problem carries.
        serde_json::from_value(Value::Object(with_params))
            .or_else(|_| serde_json::from_value(Value::Object(without_params)))
            .ok()
    }
}

#[cfg(test)]
mod tests {
    use super::ErrorCode;

    #[test]
    fn reads_back_each_code_and_its_params_from_its_problem() {
        for code in super::super::tests::every_code() {
            let answered = quoll::Error::from(code.clone()).into_answered();

            assert_eq!(ErrorCode::read(&answered), Some(code));
        }
    }

    #[test]
    fn reads_a_code_whatever_members_its_problem_carries_beside_its_params() {
        let unknown = ErrorCode::UnknownApp {
            app: "alpha".to_owned(),
        };
        let with_params = quoll::Error::from(unknown.clone()).with_member("since", "0.2.0");
        let without_params =
            quoll::Error::from(ErrorCode::SyncRunning).with_member("since", "0.2.0");

        assert_eq!(ErrorCode::read(&with_params.into_answered()), Some(unknown));
        assert_eq!(
            ErrorCode::read(&without_params.into_answered()),
            Some(ErrorCode::SyncRunning)
        );
    }

    #[test]
    fn reads_no_code_from_a_problem_of_another_type() {
        let answered = quoll::Error::bad_request("the body is not JSON")
            .with_type("/problems/elsewhere.bad")
            .into_answered();

        assert_eq!(ErrorCode::read(&answered), None);
    }
}
