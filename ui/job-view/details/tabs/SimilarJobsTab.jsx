import React from 'react';
import PropTypes from 'prop-types';

import { thMaxPushFetchSize } from '../../../helpers/constants';
import { toDateStr, toShortDateStr } from '../../../helpers/display';
import { getBtnClass, getStatus } from '../../../helpers/job';
import { getJobsUrl } from '../../../helpers/url';
import JobModel from '../../../models/job';
import PushModel from '../../../models/push';
import TextLogStepModel from '../../../models/textLogStep';
import { withSelectedJob } from '../../context/SelectedJob';
import { withNotifications } from '../../../shared/context/Notifications';

class SimilarJobsTab extends React.Component {
  constructor(props) {
    super(props);

    this.pageSize = 20;

    this.state = {
      similarJobs: [],
      filterBuildPlatformId: true,
      filterOptionCollectionHash: true,
      page: 1,
      selectedSimilarJob: null,
      hasNextPage: false,
      isLoading: true,
    };

    // map between state fields and job fields
    this.filterMap = {
      filterBuildPlatformId: 'build_platform_id',
      filterOptionCollectionHash: 'option_collection_hash',
    };
  }

  componentDidMount() {
    this.getSimilarJobs();
  }

  getSimilarJobs = async () => {
    const { page, similarJobs, selectedSimilarJob } = this.state;
    const { repoName, selectedJob, notify } = this.props;
    const options = {
      // get one extra to detect if there are more jobs that can be loaded (hasNextPage)
      count: this.pageSize + 1,
      offset: (page - 1) * this.pageSize,
    };

    ['filterBuildPlatformId', 'filterOptionCollectionHash'].forEach(key => {
      if (this.state[key]) {
        const field = this.filterMap[key];
        options[field] = selectedJob[field];
      }
    });

    const newSimilarJobs = await JobModel.getSimilarJobs(
      repoName,
      selectedJob.id,
      options,
    );

    if (newSimilarJobs.length > 0) {
      this.setState({ hasNextPage: newSimilarJobs.length > this.pageSize });
      newSimilarJobs.pop();
      // create an array of unique push ids
      const pushIds = [...new Set(newSimilarJobs.map(job => job.push_id))];
      // get pushes and revisions for the given ids
      let pushList = { results: [] };
      const resp = await PushModel.getList({
        id__in: pushIds.join(','),
        count: thMaxPushFetchSize,
      });

      if (resp.ok) {
        pushList = await resp.json();
        // decorate the list of jobs with their result sets
        const pushes = pushList.results.reduce(
          (acc, push) => ({ ...acc, [push.id]: push }),
          {},
        );
        newSimilarJobs.forEach(simJob => {
          simJob.result_set = pushes[simJob.push_id];
          simJob.revisionResultsetFilterUrl = getJobsUrl({
            repo: repoName,
            revision: simJob.result_set.revisions[0].revision,
          });
          simJob.authorResultsetFilterUrl = getJobsUrl({
            repo: repoName,
            author: simJob.result_set.author,
          });
        });
        this.setState({ similarJobs: [...similarJobs, ...newSimilarJobs] });
        // on the first page show the first element info by default
        if (!selectedSimilarJob && newSimilarJobs.length > 0) {
          this.showJobInfo(newSimilarJobs[0]);
        }
      } else {
        notify(
          `Error fetching similar jobs push data: ${resp.message}`,
          'danger',
          { sticky: true },
        );
      }
    }
    this.setState({ isLoading: false });
  };

  // this is triggered by the show previous jobs button
  showNext = () => {
    const { page } = this.state;
    this.setState({ page: page + 1, isLoading: true }, this.getSimilarJobs);
  };

  showJobInfo = job => {
    const { repoName, classificationMap } = this.props;

    JobModel.get(repoName, job.id).then(nextJob => {
      nextJob.result_status = getStatus(nextJob);
      nextJob.duration = (nextJob.end_timestamp - nextJob.start_timestamp) / 60;
      nextJob.failure_classification =
        classificationMap[nextJob.failure_classification_id];

      // retrieve the list of error lines
      TextLogStepModel.get(nextJob.id).then(textLogSteps => {
        nextJob.error_lines = textLogSteps.reduce(
          (acc, step) => [...acc, ...step.errors],
          [],
        );
        this.setState({ selectedSimilarJob: nextJob });
      });
    });
  };

  toggleFilter = filterField => {
    this.setState(
      {
        [filterField]: !this.state[filterField],
        similarJobs: [],
        isLoading: true,
      },
      this.getSimilarJobs,
    );
  };

  render() {
    const {
      similarJobs,
      selectedSimilarJob,
      hasNextPage,
      filterOptionCollectionHash,
      filterBuildPlatformId,
      isLoading,
    } = this.state;
    const button_class = job => getBtnClass(getStatus(job));
    const selectedSimilarJobId = selectedSimilarJob
      ? selectedSimilarJob.id
      : null;

    return (
      <div className="similar-jobs w-100">
        <div className="similar-job-list">
          <table className="table table-super-condensed table-hover">
            <thead>
              <tr>
                <th>Job</th>
                <th>Pushed</th>
                <th>Author</th>
                <th>Revision</th>
              </tr>
            </thead>
            <tbody>
              {similarJobs.map(similarJob => (
                <tr
                  key={similarJob.id}
                  onClick={() => this.showJobInfo(similarJob)}
                  className={
                    selectedSimilarJobId === similarJob.id ? 'table-active' : ''
                  }
                >
                  <td>
                    <button
                      className={`btn btn-similar-jobs btn-xs ${button_class(
                        similarJob,
                      )}`}
                      type="button"
                    >
                      {similarJob.job_type_symbol}
                      {similarJob.failure_classification_id > 1 && (
                        <span>*</span>
                      )}
                    </button>
                  </td>
                  <td title={toDateStr(similarJob.result_set.push_timestamp)}>
                    {toShortDateStr(similarJob.result_set.push_timestamp)}
                  </td>
                  <td>
                    <a href={similarJob.authorResultsetFilterUrl}>
                      {similarJob.result_set.author}
                    </a>
                  </td>
                  <td>
                    <a href={similarJob.revisionResultsetFilterUrl}>
                      {similarJob.result_set.revisions[0].revision}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasNextPage && (
            <button
              className="btn btn-light-bordered btn-sm link-style"
              type="button"
              onClick={this.showNext}
            >
              Show previous jobs
            </button>
          )}
        </div>
        <div className="similar-job-detail-panel">
          <form className="form form-inline">
            <div className="checkbox">
              <input
                onChange={() => this.toggleFilter('filterBuildPlatformId')}
                type="checkbox"
                checked={filterBuildPlatformId}
              />
              <small>Same platform</small>
            </div>
            <div className="checkbox">
              <input
                onChange={() => this.toggleFilter('filterOptionCollectionHash')}
                type="checkbox"
                checked={filterOptionCollectionHash}
              />
              <small>Same options</small>
            </div>
          </form>
          <div className="similar_job_detail">
            {selectedSimilarJob && (
              <table className="table table-super-condensed">
                <tbody>
                  <tr>
                    <th>Result</th>
                    <td>{selectedSimilarJob.result_status}</td>
                  </tr>
                  <tr>
                    <th>Build</th>
                    <td>
                      {selectedSimilarJob.build_architecture}{' '}
                      {selectedSimilarJob.build_platform}{' '}
                      {selectedSimilarJob.build_os}
                    </td>
                  </tr>
                  <tr>
                    <th>Build option</th>
                    <td>{selectedSimilarJob.platform_option}</td>
                  </tr>
                  <tr>
                    <th>Job name</th>
                    <td>{selectedSimilarJob.job_type_name}</td>
                  </tr>
                  <tr>
                    <th>Started</th>
                    <td>{toDateStr(selectedSimilarJob.start_timestamp)}</td>
                  </tr>
                  <tr>
                    <th>Duration</th>
                    <td>
                      {selectedSimilarJob.duration >= 0
                        ? `${selectedSimilarJob.duration.toFixed(0)} minute(s)`
                        : 'unknown'}
                    </td>
                  </tr>
                  <tr>
                    <th>Classification</th>
                    <td>
                      <label
                        className={`badge ${
                          selectedSimilarJob.failure_classification.star
                        }`}
                      >
                        {selectedSimilarJob.failure_classification.name}
                      </label>
                    </td>
                  </tr>
                  {!!selectedSimilarJob.error_lines && (
                    <tr>
                      <td colSpan={2}>
                        <ul className="list-unstyled error_list">
                          {selectedSimilarJob.error_lines.map(error => (
                            <li key={error.id}>
                              <small title={error.line}>{error.line}</small>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
        {isLoading && (
          <div className="overlay">
            <div>
              <span className="fa fa-spinner fa-pulse th-spinner-lg" />
            </div>
          </div>
        )}
      </div>
    );
  }
}

SimilarJobsTab.propTypes = {
  repoName: PropTypes.string.isRequired,
  classificationMap: PropTypes.object.isRequired,
  notify: PropTypes.func.isRequired,
  selectedJob: PropTypes.object,
};

SimilarJobsTab.defaultProps = {
  selectedJob: null,
};

export default withNotifications(withSelectedJob(SimilarJobsTab));
